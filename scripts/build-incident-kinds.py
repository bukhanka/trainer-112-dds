#!/usr/bin/env python3
"""Build data/incident-kinds.json: the «Что случилось» list, frequent buttons and tag panels.

Usage:
    python3 scripts/build-incident-kinds.py [-o data/incident-kinds.json]

Sources (customer materials, transcribed by hand):
  * «КАРТОЧКА 112»: the «Что случилось» list, frequent-type buttons, the full tag trees
    for 101 (Улица / Транспорт / Дом), 104 and «Взрыв» as clicked on the screenshots;
  * data/classifier.json: leaves for every option (resolved here by the final type name,
    so a renamed type fails the build instead of silently breaking the panel), and the
    signs G → H → I for the generic panels of the other groups.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ─── «Что случилось» ─────────────────────────────────────────────────────────
# groupId / subgroup / typeCodes say where the kind leads in the classifier;
# tree = one of the hand-made panels below; service = a call without an incident.
KINDS: list[dict] = [
    {"name": "101", "groupId": 1, "tree": "fire101", "title": "Происшествие 101"},
    {"name": "102", "groupId": 15, "title": "Происшествие 102"},
    {"name": "103", "groupId": 22, "title": "Происшествие 103"},
    {"name": "104", "groupId": 13, "tree": "gas104", "title": "Происшествие 104"},
    {"name": "Аварии и происшествия в городском хозяйстве", "groupId": 14},
    {"name": "Аварии и происшествия на транспортных объектах", "groupId": 12},
    {"name": "Аварии на гидротехнических сооружениях", "groupId": 9},
    {"name": "Аварии на опасных и производственных объектах", "groupId": 10, "subgroup": "Авария - опасный и производственный объект"},
    {"name": "Благодарность службам", "typeNames": ["Благодарность"]},
    {"name": "БПЛА", "groupId": 24},
    {"name": "Взрыв", "groupId": 3, "tree": "explosion", "title": "П: Взрыв"},
    {"name": "Внутренний звонок (звонок от работников)", "service": True},
    {"name": "Вызов на иностранном языке", "service": True},
    {"name": "Дополнительный звонок от заявителя", "service": True},
    {"name": "Дорожные помехи", "groupId": 16},
    {"name": "ДТП", "groupId": 2},
    {"name": "Жалоба на действие или бездействие служб", "typeNames": ["Жалоба"]},
    {"name": "Животные", "groupId": 21},
    {"name": "Консультация", "typeNames": ["Справка"]},
    {"name": "Нецелевой вызов", "service": True},
    {"name": "Обрушение", "groupId": 5},
    {"name": "Отзыв о работе 112 Москва", "service": True},
    {"name": "Отмена вызова", "service": True},
    {"name": "Ошибочно набран номер", "service": True},
    {"name": "Передача дежурства", "service": True},
    {"name": "Помощь службам", "typeNames": ["Помощь службам"]},
    {"name": "Природная стихия", "groupId": 7, "subgroup": "Природная стихия"},
    {"name": "Прочие происшествия", "typeNames": ["Прочие происшествия"]},
    {"name": "Радиация", "groupId": 10, "subgroup": "Радиация"},
    {"name": "Разбитый градусник", "groupId": 11, "subgroup": "Ртуть - обнаружение"},
    {"name": "Ребенок в опасности", "groupId": 18},
    {"name": "Сбор", "service": True},
    {"name": "Скопление воды", "groupId": 7, "subgroup": "Скопление воды Подтопление Паводок"},
    {"name": "Смертельный исход", "groupId": 19},
    {"name": "Социальная помощь", "groupId": 20},
    {"name": "Справка 101", "typeNames": ["Справка"], "addressee": "Служба 101"},
    {"name": "Справка 102", "typeNames": ["Справка"], "addressee": "Служба 102"},
    {"name": "Справка 103", "typeNames": ["Справка"], "addressee": "Служба 103"},
    {"name": "Справка 104", "typeNames": ["Справка"], "addressee": "Служба 104"},
    {"name": "Справка ГИБДД", "typeNames": ["Справка"], "addressee": "Служба 102"},
    {"name": "Справка Городское хозяйство", "typeNames": ["Справка"], "addressee": "Деп. ЖКХ"},
    {"name": "Справка МЧС", "typeNames": ["Справка"], "addressee": "Служба 101"},
    {"name": "Тестовый вызов", "service": True},
    {"name": "Технический сбой (сбой в работе с оборудованием 112 Москва)", "service": True},
    {"name": "Тренировка", "typeNames": ["Тренировка"]},
    {"name": "Уведомление о ЧС", "service": True},
    {"name": "Угроза взрыва/террористического акта", "groupId": 4},
    {"name": "Угроза выброса опасных веществ и радиации", "groupId": 11},
    {"name": "Угроза обрушения", "groupId": 6},
    {"name": "Человек в опасности", "groupId": 17},
    {"name": "Экологическое происшествие", "groupId": 8},
]

# Buttons above «что случилось?» on the two workstations of the screenshots.
FREQUENT = {
    "default": [
        "ДТП", "Ошибочно набран номер", "104", "Человек в опасности", "Отмена вызова",
        "Тестовый вызов", "Передача дежурства", "Консультация", "Вызов на иностранном языке", "Справка 101",
    ],
    "alternative": [
        "Отмена вызова", "Тестовый вызов", "Передача дежурства", "ДТП", "Консультация",
        "Вызов на иностранном языке", "Ошибочно набран номер", "Справка 101", "Справка 102", "Справка 103",
    ],
}

# ─── Rows that switch routing conditions (IncidentFlags keys) ────────────────
# placement: card = the three buttons above the incident type; panel = a row of the tag panel.
FLAG_ROWS: list[dict] = [
    {"flag": "victims", "condition": "victims", "label": "Пострадавшие", "kind": "toggle", "placement": "card"},
    {"flag": "refusedAmbulance", "condition": "victims_absent", "label": "Нет на месте / Отказ от скорой", "kind": "toggle", "placement": "card"},
    {"flag": "noAccess", "condition": "no_access", "label": "Нет доступа / Заблокированные", "kind": "toggle", "placement": "card"},
    {"flag": "threat", "condition": "threat", "label": "Угроза людям", "kind": "yesno", "placement": "panel"},
    {"flag": "med", "condition": "med", "label": "Медицинская помощь", "kind": "yesno", "placement": "panel"},
    {"flag": "evac", "condition": "evac", "label": "Требуется эвакуация", "kind": "yesno", "placement": "panel"},
    {"flag": "gas", "condition": "gas", "label": "Проведена ли газификация", "kind": "yesnounknown", "placement": "panel"},
    {"flag": "offense", "condition": "offense", "label": "Правонарушение", "kind": "toggle", "option": "Есть правонарушение", "placement": "panel"},
    {"flag": "traffic", "condition": "traffic", "label": "Есть ли перекрытие движения", "kind": "yesno", "placement": "panel"},
    {"flag": "tunnel", "condition": "tunnel", "label": "Тоннель", "kind": "toggle", "placement": "panel"},
    {"flag": "crossing", "condition": "crossing", "label": "Пешеходный переход", "kind": "toggle", "placement": "panel"},
    {"flag": "road", "condition": "road", "label": "Автомобильный мост / тоннель", "kind": "toggle", "placement": "panel"},
    {"flag": "crowd", "condition": "crowd", "label": "Более 5 человек / ОД", "kind": "toggle", "placement": "panel"},
    {"flag": "construction", "condition": "construction", "label": "Стройка", "kind": "toggle", "placement": "panel"},
    {"flag": "objectList", "condition": "object_list", "label": "Объект из перечня (Деп. культуры)", "kind": "toggle", "placement": "panel"},
    {"flag": "comm", "condition": "comm", "label": "Объект связи", "kind": "toggle", "placement": "panel"},
]

FLAME = "Открытое пламя / Дым"


# Street objects: option → (flame leaf names, smoke leaf names)
STREET_OBJECTS = [
    ("Мусор", ["пожар: мусор"], ["задымление: мусор"]),
    ("Трава, пух", ["пожар: трава"], ["задымление: трава"]),  # «пух» is a separate leaf, reachable by signs
    ("Парк", ["пожар: парк"], ["задымление: парк"]),
    ("Лес", ["пожар: лес"], ["задымление: лес"]),
    ("Торф", ["пожар: торф"], ["задымление: торф"]),
    ("Мачта освещения", ["пожар: мачта освещения"], ["задымление: мачта освещения"]),
    ("Опора контактной сети", ["пожар: опора контактной сети"], ["задымление: опора контактной сети"]),
    ("ЛЭП", ["пожар: ЛЭП"], ["задымление: ЛЭП"]),
    ("Провода", ["пожар: провода на улице"], ["задымление: провода на улице"]),
    ("Дерево, деревья", ["пожар: дерево, деревья"], ["задымление: дерево, деревья"]),
    ("Горит человек", None, None),  # no own leaf in v046_24: see data/README.md
    ("Что горит неизвестно", ["Пожар: прочие объекты"], ["задымление: прочие объекты"]),
]
STREET_NO_LEAF = {"Горит человек"}

TRANSPORT_OBJECTS = [
    ("Общественный транспорт", ["пожар: автобус"], ["задымление: автобус"]),
    ("Автомашина", ["пожар: машина"], ["задымление: машина"]),
    ("ДТП с пожаром", ["пожар при ДТП"], ["задымление при ДТП"]),
    ("Опасный груз", ["пожар: опасный груз"], ["задымление: опасный груз"]),
    ("Воздушный транспорт", ["пожар: воздушный транспорт"], ["задымление: воздушный транспорт"]),
    ("Аэропорт", ["пожар: аэропорт"], ["задымление: аэропорт"]),
    ("Ж/Д транспорт", ["пожар: жд транспорт"], ["задымление: жд транспорт"]),
    ("Вокзал Ж/Д, платформа Ж/Д", ["пожар: вокзал"], ["задымление: вокзал"]),
    ("Транспорт прочее", ["пожар: транспорт (прочее)"], ["задымление: транспорт (прочее)"]),
    ("Водный", ["пожар: водный транспорт"], ["задымление: водный транспорт"]),
    ("Мост", ["пожар: мост"], ["задымление: мост"]),
    ("Эстакада", ["пожар: эстакада"], ["задымление: эстакада"]),
    ("Тоннель", ["пожар: тоннель"], ["задымление: тоннель"]),
    ("Переход подземный/наземный", ["пожар: переход"], ["задымление: переход"]),
    ("Метро", ["пожар: метро"], ["задымление: метро"]),
    ("МЦК, МЦД", ["пожар: МЦК"], ["задымление: МЦК"]),
    ("Ж/Д пути", ["пожар: жд транспорт"], ["задымление: жд транспорт"]),
    ("Релейный шкаф Ж/Д", ["пожар: жд транспорт"], ["задымление: жд транспорт"]),
]

HOUSE_KINDS = [
    ("Дом многоквартирный", None, None),  # leaf comes from «Внутридомовые объекты»
    ("Дом частный", ["пожар: частный дом"], ["задымление: частный дом"]),
    ("Дача", ["пожар: дача"], ["задымление: дача"]),
    ("Сарай / бытовка / хоз. постройка", ["Пожар: Сарай"], []),
    ("Выселенное здание", ["Пожар: Выселенное здание"], []),
]

HOUSE_INNER = [
    ("Квартира", "квартира"),
    ("Балкон", "балкон"),
    ("Газовая колонка", "газовая колонка"),
    ("Газовая плита", "газовая плита"),
    ("Лифт", "лифт"),
    ("Мусоропровод", "мусоропровод"),
    ("Подъезд", "подъезд"),
    ("Счетчик электричества", "счетчик электричества"),
    ("Электрическая проводка", "электрическая проводка"),
    ("Электрощит", "электрощит"),
    ("Лестничная клетка", "лестничная клетка"),
    ("Подвал", "подвал"),
    ("Прочие внутридомовые объекты", None),
    ("Крыша", None),
]

BUILDINGS = [
    ("Учебное заведение", ["Пожар: учебное заведение"], ["задымление: учебное заведение"]),
    ("Лечебное заведение", ["пожар: лечебное заведение"], ["задымление: лечебное заведение"]),
    ("Административное здание", ["пожар: административное здание"], ["задымление: административное здание"]),
    ("Общественное место", ["пожар: общественное место"], ["задымление: общественное место"]),
    ("Производство", ["пожар: производство"], ["задымление: производство"]),
    ("АЗС", ["пожар: АЗС"], ["задымление: АЗС"]),
    ("Прочие объекты", ["Пожар: прочие объекты"], ["задымление: прочие объекты"]),
]

DANGEROUS = [
    ("Опасный объект", ["пожар: опасный объект"], ["задымление: опасный объект"]),
    ("Газопровод", ["пожар: газопровод"], []),
    ("Газохранилище", ["пожар: газохранилище"], []),
    ("Нефтепровод, нефтебаза", ["пожар: нефтебаза"], []),
    ("Нефтехранилище", ["пожар: нефтехранилище"], []),
    ("Наземные коммуникации", ["пожар: наземные коммуникации"], ["задымление: наземные коммуникации"]),
    ("Подземные коммуникации", ["пожар: подземные коммуникации"], ["задымление: подземные коммуникации"]),
    ("Гидросооружение", ["пожар: гидросооружение"], ["задымление: гидросооружение"]),
]


class Resolver:
    def __init__(self, classifier: dict):
        self.by_name: dict[str, dict] = {}
        for t in classifier["types"]:
            self.by_name.setdefault(self.key(t["finalType"]), t)
        self.types = classifier["types"]

    @staticmethod
    def key(name: str) -> str:
        return " ".join(name.lower().replace("ё", "е").split())

    def codes(self, names: list[str] | None) -> list[int]:
        out = []
        for name in names or []:
            t = self.by_name.get(self.key(name))
            if t is None:
                sys.exit(f"incident-kinds: no classifier leaf «{name}»")
            out.append(t["code"])
        return out


def option(value: str, r: Resolver, flame: list[str] | None = None, smoke: list[str] | None = None, **extra) -> dict:
    out = {"value": value}
    if flame:
        out["types"] = r.codes(flame)
    if smoke:
        out["smokeTypes"] = r.codes(smoke)
    out.update({k: v for k, v in extra.items() if v is not None})
    return out


def fire_tree(r: Resolver) -> dict:
    inner = []
    for label, obj in HOUSE_INNER:
        if obj:
            inner.append(option(label, r, [f"пожар: {obj}"], [f"задымление: {obj}"]))
        elif label == "Крыша":
            inner.append(option(label, r, ["Пожар: Крыша"]))
        else:
            inner.append(option(label, r, ["пожар: жилой дом (прочее)"], ["задымление: жилой дом (прочие)"]))
    hidden_objects = sorted(
        (t for t in r.types if t["groupId"] == 1 and t["hiddenFromOperator"]), key=lambda t: t["finalType"].lower()
    )
    return {
        "id": "fire101",
        "title": "Происшествие 101",
        "groupId": 1,
        "rows": [
            {"id": "where", "label": "Где", "kind": "single",
             "options": [{"value": v} for v in ["Улица", "Транспорт", "Дом", "Здание / объект", "Опасный объект"]]},
            {"id": "signStreet", "label": "Признак пожара (улица)", "kind": "single", "showIf": {"where": ["Улица"]},
             "options": [option(FLAME, r), option("Запах гари", r, ["запах гари на улице"])]},
            {"id": "signTransport", "label": "Признак пожара (транспорт)", "kind": "single", "showIf": {"where": ["Транспорт"]},
             "options": [option(FLAME, r), option("Сработала пожарная сигнализация", r, ["пожарная сигнализация (метро)"])]},
            {"id": "signHouse", "label": "Признак пожара (дом)", "kind": "single", "showIf": {"where": ["Дом"]},
             "options": [option(FLAME, r), option("Запах гари", r), option("Сработала пожарная сигнализация", r, ["пожарная сигнализация (жилой дом)"])]},
            {"id": "signObject", "label": "Признак пожара (объект)", "kind": "single",
             "showIf": {"where": ["Здание / объект", "Опасный объект"]},
             "options": [option(FLAME, r), option("Сработала пожарная сигнализация", r, ["пожарная сигнализация на объекте"])]},
            {"id": "access", "label": "Доступ", "kind": "toggle", "flag": "noAccess", "showIf": {"where": ["*"]},
             "options": [{"value": "Нет доступа"}]},
            {"id": "placeStreet", "label": "Место происшествия", "kind": "multi", "showIf": {"where": ["Улица"]},
             "options": [{"value": "Тоннель", "flag": "tunnel"}, {"value": "Пешеходный переход", "flag": "crossing"}]},
            {"id": "streetObject", "label": "Улица (пламя, дым)", "kind": "single", "showIf": {"signStreet": [FLAME]},
             "options": [option(v, r, f, s, noLeaf=True if v in STREET_NO_LEAF else None) for v, f, s in STREET_OBJECTS]},
            {"id": "transportObject", "label": "Транспорт (пламя, дым)", "kind": "single", "showIf": {"signTransport": [FLAME]},
             "options": [option(v, r, f, s) for v, f, s in TRANSPORT_OBJECTS]},
            {"id": "houseKind", "label": "Дом (пламя, дым)", "kind": "single", "showIf": {"signHouse": [FLAME]},
             "options": [option(v, r, f, s) for v, f, s in HOUSE_KINDS]},
            {"id": "houseSmell", "label": "Где запах гари", "kind": "single", "showIf": {"signHouse": ["Запах гари"]},
             "options": [option("Квартира", r, ["запах гари в доме"]), option("Подъезд", r, ["запах гари в подъезде"])]},
            {"id": "floors", "label": "Этажность здания", "kind": "text", "showIf": {"where": ["Дом"]}},
            {"id": "buildingObject", "label": "Здание / объект (пламя, дым)", "kind": "single",
             "showIf": {"where": ["Здание / объект"], "signObject": [FLAME]},
             "options": [option(v, r, f, s) for v, f, s in BUILDINGS]},
            {"id": "buildingDetail", "label": "Вид объекта (уточнение)", "kind": "single",
             "showIf": {"where": ["Здание / объект"], "signObject": [FLAME]},
             "options": [option(t["finalType"].split(":", 1)[-1].strip(), r, [t["finalType"]]) for t in hidden_objects]},
            {"id": "dangerousObject", "label": "Опасный объект (пламя, дым)", "kind": "single",
             "showIf": {"where": ["Опасный объект"], "signObject": [FLAME]},
             "options": [option(v, r, f, s) for v, f, s in DANGEROUS]},
            {"id": "threat", "label": "Угроза людям", "kind": "yesno", "flag": "threat",
             "showIf": {"where": ["*"], "anyOf": ["streetObject", "transportObject", "houseKind", "buildingObject", "dangerousObject"]}},
            {"id": "houseInner", "label": "Внутридомовые объекты (пламя, дым)", "kind": "multi",
             "showIf": {"houseKind": ["Дом многоквартирный"]}, "options": inner},
            {"id": "offense", "label": "Правонарушение", "kind": "toggle", "flag": "offense",
             "showIf": {"streetObject": ["*"]}, "options": [{"value": "Есть правонарушение"}]},
            {"id": "offenseText", "label": "Описание правонарушения", "kind": "text", "showIf": {"offense": ["*"]}},
            {"id": "med", "label": "Медицинская помощь", "kind": "yesno", "flag": "med",
             "showIf": {"where": ["Улица", "Транспорт", "Здание / объект", "Опасный объект"], "anyOf": ["streetObject", "transportObject", "buildingObject", "dangerousObject"]}},
            {"id": "evac", "label": "Требуется эвакуация", "kind": "yesno", "flag": "evac",
             "showIf": {"where": ["Улица", "Транспорт", "Здание / объект", "Опасный объект"], "anyOf": ["streetObject", "transportObject", "buildingObject", "dangerousObject"]}},
            {"id": "traffic", "label": "Есть ли перекрытие движения", "kind": "yesno", "flag": "traffic",
             "showIf": {"where": ["Дом", "Здание / объект", "Опасный объект"], "anyOf": ["houseKind", "buildingObject", "dangerousObject"]}},
            {"id": "gas", "label": "Проведена ли газификация", "kind": "yesnounknown", "flag": "gas",
             "showIf": {"where": ["Улица", "Дом", "Здание / объект"], "anyOf": ["streetObject", "houseKind", "buildingObject"]}},
            {"id": "objectFlags", "label": "Особенности объекта", "kind": "multi",
             "showIf": {"where": ["Здание / объект", "Опасный объект"]},
             "options": [{"value": "Объект из перечня (Деп. культуры)", "flag": "objectList"},
                         {"value": "Стройка", "flag": "construction"},
                         {"value": "Объект связи", "flag": "comm"}]},
            {"id": "description", "label": "Описание", "kind": "text"},
        ],
    }


GAS_LEVEL1 = [
    ("Запах газа вне помещения (на улице)", "Запах газа на улице"),
    ("Запах газа в помещении (в квартире, в доме)", "Запах газа в помещении"),
    ("Нарушение в работе газового оборудования", "Нарушение работы газового оборудования"),
    ("Повреждение газопровода", "Повреждение газопровода"),
    ("Повышенное давление газа", "Повышенное давление газа"),
]

EXPLOSION_LEVEL1 = [
    ("Здание / Объект", "Взрыв объект"),
    ("Транспорт", "Взрыв транспорт"),
    ("Звуки похожие на взрыв, что взорвалось сообщить не может", "Звуки похожие на взрыв, что взорвалось сообщить не может"),
]


def signs_tree(r: Resolver, tree_id: str, title: str, group_id: int, level1: list[tuple[str, str]],
               labels: tuple[str, str, str], extra_rows: list[dict]) -> dict:
    """Panel whose options follow the classifier signs G → H → I of one group.

    Options of the second and third rows carry `parent` (the chosen option above,
    «<sign1>/<sign2>» for the third row); an option gets `types` when a leaf ends on it.
    """
    leaves = [t for t in r.types if t["groupId"] == group_id and not t["hiddenFromOperator"]]
    sign1_opts, sign2_opts, sign3_opts = [], [], []
    for ui, g in level1:
        own = [t["code"] for t in leaves if t["sign1"] == g and not t["sign2"]]
        sign1_opts.append({"value": ui, "sign": g, **({"types": own} if own else {})})
        h_values: list[str] = []
        for t in leaves:
            if t["sign1"] == g and t["sign2"] and t["sign2"] not in h_values:
                h_values.append(t["sign2"])
        for h in h_values:
            own2 = [t["code"] for t in leaves if t["sign1"] == g and t["sign2"] == h and not t["sign3"]]
            sign2_opts.append({"value": h.strip(), "sign": h, "parent": ui, **({"types": own2} if own2 else {})})
            for t in leaves:
                if t["sign1"] == g and t["sign2"] == h and t["sign3"]:
                    sign3_opts.append({"value": t["sign3"].strip(), "sign": t["sign3"], "parent": f"{ui}/{h.strip()}", "types": [t["code"]]})
    rows = [
        {"id": "sign1", "label": labels[0], "kind": "single", "options": sign1_opts},
        {"id": "sign2", "label": labels[1], "kind": "single", "showIf": {"sign1": ["*"]}, "dependsOn": "sign1", "options": sign2_opts},
        {"id": "sign3", "label": labels[2], "kind": "single", "showIf": {"sign2": ["*"]}, "dependsOn": "sign2", "options": sign3_opts},
    ]
    rows.extend(extra_rows)
    rows.append({"id": "description", "label": "Описание", "kind": "text"})
    return {"id": tree_id, "title": title, "groupId": group_id, "bySigns": True, "rows": rows}


def group_flags(classifier: dict) -> dict[str, list[str]]:
    """Which flag rows matter for each group: conditions present in its routes."""
    cond_to_flag = {row["condition"]: row["flag"] for row in FLAG_ROWS}
    order = [row["flag"] for row in FLAG_ROWS]
    out: dict[str, set[str]] = {}
    for t in classifier["types"]:
        for _, cond, _ in t["routes"]:
            if cond in cond_to_flag:
                out.setdefault(str(t["groupId"]), set()).add(cond_to_flag[cond])
    return {g: sorted(flags, key=order.index) for g, flags in sorted(out.items(), key=lambda kv: int(kv[0]))}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("-o", "--out", type=Path, default=ROOT / "data" / "incident-kinds.json")
    args = ap.parse_args()
    classifier = json.loads((ROOT / "data" / "classifier.json").read_text(encoding="utf-8"))
    r = Resolver(classifier)

    kinds = []
    for k in KINDS:
        entry = {key: value for key, value in k.items() if key != "typeNames"}
        if "typeNames" in k:
            entry["typeCodes"] = r.codes(k["typeNames"])
        kinds.append(entry)
    names = {k["name"] for k in kinds}
    for buttons in FREQUENT.values():
        missing = [b for b in buttons if b not in names]
        if missing:
            sys.exit(f"frequent buttons not in the list: {missing}")

    trees = {
        "fire101": fire_tree(r),
        "gas104": signs_tree(
            r, "gas104", "Происшествие 104", 13, GAS_LEVEL1,
            ("Признаки происшествия", "Где / что", "Уточнение"),
            [{"id": "threat", "label": "Угроза людям", "kind": "yesno", "flag": "threat", "showIf": {"sign1": ["*"]}},
             {"id": "gasSource", "label": "Газ магистральный или баллон", "kind": "single", "showIf": {"sign1": ["*"]},
              "options": [{"value": "Магистральный"}, {"value": "Баллон"}, {"value": "Не знает"}]}],
        ),
        "explosion": signs_tree(
            r, "explosion", "П: Взрыв", 3, EXPLOSION_LEVEL1,
            ("Где взрыв", "Что взорвалось", "Уточнение"),
            [{"id": "burning", "label": "Есть возгорание", "kind": "yesno", "showIf": {"sign1": ["*"]}},
             {"id": "collapseThreat", "label": "Есть угроза обрушения", "kind": "yesno", "showIf": {"sign1": ["*"]}},
             {"id": "damage", "label": "Какие видят разрушения", "kind": "text", "showIf": {"sign1": ["*"]}}],
        ),
    }

    out = {
        "note": "«Что случилось» (customer list), frequent buttons, flag rows and tag panels; type codes from data/classifier.json",
        "kinds": kinds,
        "frequent": FREQUENT,
        "flagRows": FLAG_ROWS,
        "groupFlags": group_flags(classifier),
        "genericLabels": ["Что случилось", "Где / что", "Уточнение"],
        "trees": trees,
    }
    args.out.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(f"{args.out}: {len(kinds)} kinds, {len(trees)} trees, flags for {len(out['groupFlags'])} groups")


if __name__ == "__main__":
    main()
