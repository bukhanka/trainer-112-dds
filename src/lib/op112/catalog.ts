/**
 * «Что случилось?» list and questionnaire cards of the 112 workstation.
 *
 * The list follows the customer's «КАРТОЧКА 112» table; the questionnaire rows are copied from the
 * workstation screenshots (101: Улица / Транспорт / Дом, 104, Взрыв). Types without a known
 * questionnaire get a card with a single «Описание» row. When the classifier-based tag tree is
 * loaded into the database it replaces these cards (see routing.ts).
 */
import type { QuestionCard, QuestionRow, RowCondition, WhatHappened } from "./types";

const code = (key: string, synonyms: string[]): WhatHappened => ({
  key,
  name: key,
  chip: `Происшествие ${key}`,
  synonyms,
  group: "code",
});
const type = (key: string, name: string, synonyms: string[] = [], group: WhatHappened["group"] = "type"): WhatHappened => ({
  key,
  name,
  chip: `П: ${name}`,
  synonyms,
  group,
});

export const WHAT_HAPPENED: WhatHappened[] = [
  code("101", ["пожар", "горит", "возгорание", "дым", "задымление", "пламя", "взрыв", "обрушение", "авария", "авиакатастрофа", "выброс"]),
  code("102", ["полиция", "драка", "кража", "угон", "грабеж", "нападение", "хулиганство", "шум"]),
  code("103", ["скорая", "вызов 03", "плохо", "травма", "без сознания", "давление", "отравление", "роды"]),
  code("104", ["газ", "запах газа", "утечка газа"]),
  type("gorhoz", "Аварии и происшествия в городском хозяйстве", ["прорыв трубы", "нет света", "лифт", "затопление"]),
  type("transport", "Аварии и происшествия на транспортных объектах", ["метро", "электричка", "трамвай"]),
  type("hydro", "Аварии на гидротехнических сооружениях", ["плотина", "дамба"]),
  type("industrial", "Аварии на опасных и производственных объектах", ["завод", "производство"]),
  type("thanks", "Благодарность службам", [], "service"),
  type("uav", "БПЛА", ["беспилотник", "дрон"]),
  type("explosion", "Взрыв", ["взорвалось", "хлопок"]),
  type("internal", "Внутренний звонок (звонок от работников)", [], "service"),
  type("foreign", "Вызов на иностранном языке", ["иностранец", "english"], "service"),
  type("extra", "Дополнительный звонок от заявителя", ["повторный звонок"], "service"),
  type("roadblock", "Дорожные помехи", ["яма", "светофор"]),
  type("dtp", "ДТП", ["авария", "столкновение", "наезд", "сбили"]),
  type("complaint", "Жалоба на действие или бездействие служб", [], "service"),
  type("animals", "Животные", ["собака", "кошка", "укус"]),
  type("consult", "Консультация", [], "service"),
  type("offtarget", "Нецелевой вызов", [], "service"),
  type("collapse", "Обрушение", ["рухнуло", "обвал"]),
  type("feedback", "Отзыв о работе 112 Москва", [], "service"),
  type("cancel", "Отмена вызова", [], "service"),
  type("wrongnumber", "Ошибочно набран номер", [], "service"),
  type("duty", "Передача дежурства", [], "service"),
  type("helpservices", "Помощь службам", [], "service"),
  type("nature", "Природная стихия", ["ураган", "ливень", "град", "дерево упало"]),
  type("other", "Прочие происшествия"),
  type("radiation", "Радиация"),
  type("thermometer", "Разбитый градусник", ["ртуть"]),
  type("child", "Ребенок в опасности", ["ребенок", "ребёнок"]),
  type("gathering", "Сбор", ["митинг"]),
  type("water", "Скопление воды", ["лужа", "подтопление"]),
  type("death", "Смертельный исход", ["труп", "умер"]),
  type("social", "Социальная помощь", ["бездомный"]),
  type("info101", "Справка-101", [], "info"),
  type("info102", "Справка-102", [], "info"),
  type("info103", "Справка-103", [], "info"),
  type("info104", "Справка-104", [], "info"),
  type("infoGibdd", "Справка-ГИБДД", [], "info"),
  type("infoGorhoz", "Справка Городское Хозяйство", [], "info"),
  type("infoMchs", "Справка-МЧС", [], "info"),
  type("test", "Тестовый вызов", [], "service"),
  type("failure", "Технический сбой (сбой в работе оборудования 112 Москва)", [], "service"),
  type("drill", "Тренировка", [], "service"),
  type("chsNotice", "Уведомление о ЧС", [], "service"),
  type("terror", "Угроза взрыва/террористического акта", ["теракт", "бомба", "заминировано"]),
  type("toxic", "Угроза выброса опасных веществ и радиации"),
  type("collapseThreat", "Угроза обрушения", ["трещина"]),
  type("person", "Человек в опасности", ["застрял", "на льдине", "на крыше", "тонет"]),
  type("ecology", "Экологические происшествия", ["разлив", "свалка"]),
];

const BY_KEY = new Map(WHAT_HAPPENED.map((w) => [w.key, w]));

export function whatHappened(key: string): WhatHappened | undefined {
  return BY_KEY.get(key);
}

/** Buttons above the input (the second workstation's set from the screenshots). */
export const FREQUENT_KEYS = ["dtp", "wrongnumber", "104", "person", "cancel", "test", "duty", "consult", "foreign", "info101"];

/** «Значимые типы происшествий» — the list the 112 management approves. */
export const SIGNIFICANT_KEYS = ["101", "102", "103", "explosion"];

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[-,.:;«»"()/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Search like the workstation: every word is a substring of the name or a synonym, any order. */
export function searchWhatHappened(query: string, limit = 12): WhatHappened[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (!words.length) return WHAT_HAPPENED.slice(0, limit);
  const scored: { w: WhatHappened; score: number }[] = [];
  for (const w of WHAT_HAPPENED) {
    const name = norm(w.name);
    const hay = [name, ...(w.synonyms ?? []).map(norm)].join(" | ");
    if (!words.every((word) => hay.includes(word))) continue;
    const score = (name.startsWith(words[0]) ? 0 : 1) + (words.every((word) => name.includes(word)) ? 0 : 2);
    scored.push({ w, score });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((s) => s.w);
}

// ─── Questionnaire cards ─────────────────────────────────────────────────────

const YES_NO = ["Да", "Нет"];
const is = (row: string, ...values: string[]): RowCondition => ({ row, is: values });
const all = (...c: RowCondition[]): RowCondition => ({ all: c });

const FLAME = "Открытое пламя / Дым";
const SMELL = "Запах гари";
const ALARM = "Сработала пожарная сигнализация";

const STREET_OBJECTS = [
  "Мусор",
  "Трава, пух",
  "Парк",
  "Лес",
  "Торф",
  "Мачта освещения",
  "Опора контактной сети",
  "ЛЭП",
  "Провода",
  "Дерево, деревья",
  "Горит человек",
  "Что горит неизвестно",
];
const TRANSPORT_OBJECTS = [
  "Общественный транспорт",
  "Автомашина",
  "ДТП с пожаром",
  "Опасный груз",
  "Воздушный транспорт",
  "Аэропорт",
  "Ж/Д транспорт",
  "Вокзал Ж/Д, платформа Ж/Д",
  "Транспорт прочее",
  "Водный",
  "Мост",
  "Эстакада",
  "Тоннель",
  "Переход подземный/наземный",
  "Метро",
  "МЦК, МЦД",
  "Ж/Д пути",
  "Релейный шкаф Ж/Д",
];
const HOUSE_KINDS = ["Дом многоквартирный", "Дом частный", "Дача", "Сарай / бытовка / хоз. постройка", "Выселенное здание"];
const HOUSE_OBJECTS = [
  "Квартира",
  "Балкон",
  "Газовая колонка",
  "Газовая плита",
  "Лифт",
  "Мусоропровод",
  "Подъезд",
  "Счетчик электричества",
  "Электрическая проводка",
  "Электрощит",
  "Лестничная клетка",
  "Подвал",
  "Прочие внутридомовые объекты",
  "Крыша",
];
const BUILDING_KINDS = ["Учебное заведение", "Больница, поликлиника", "Торговый центр, магазин", "Офис", "Склад", "Здание прочее"];

const onStreetFlame = all(is("where", "Улица"), is("fireStreet", FLAME));
const onTransportFlame = all(is("where", "Транспорт"), is("fireTransport", FLAME));
const onHouseFlame = all(is("where", "Дом"), is("fireHouse", FLAME));
const onBuildingFlame = all(is("where", "Здание / объект"), is("fireBuilding", FLAME));

const card101: QuestionCard = {
  key: "101",
  title: "Происшествие 101",
  rows: [
    { id: "where", label: "Где", kind: "single", options: ["Улица", "Транспорт", "Дом", "Здание / объект", "Опасный объект"] },
    // Улица
    { id: "fireStreet", label: "Признак пожара (улица)", kind: "single", options: [FLAME, SMELL], showIf: is("where", "Улица") },
    { id: "accessStreet", label: "Доступ", kind: "toggle", options: ["Нет доступа"], flag: "noAccess", showIf: is("where", "Улица") },
    { id: "streetObject", label: "Улица (пламя, дым)", kind: "single", options: STREET_OBJECTS, showIf: onStreetFlame },
    { id: "streetPlace", label: "Место происшествия", kind: "single", options: ["Тоннель", "Пешеходный переход"], showIf: is("where", "Улица") },
    { id: "threatStreet", label: "Угроза людям", kind: "single", options: YES_NO, flag: "threat", showIf: onStreetFlame },
    {
      id: "offense",
      label: "Правонарушение",
      kind: "toggle",
      options: ["Есть правонарушение"],
      flag: "offense",
      showIf: all(onStreetFlame, { row: "streetObject", answered: true }),
    },
    { id: "offenseText", label: "Описание правонарушения", kind: "text", showIf: is("offense", "Есть правонарушение") },
    { id: "medStreet", label: "Медицинская помощь", kind: "single", options: YES_NO, flag: "med", showIf: onStreetFlame },
    { id: "evacStreet", label: "Требуется эвакуация", kind: "single", options: YES_NO, flag: "evac", showIf: onStreetFlame },
    { id: "gasStreet", label: "Проведена ли газификация", kind: "single", options: ["Да", "Нет", "Нет данных"], flag: "gas", showIf: onStreetFlame },
    // Транспорт
    { id: "fireTransport", label: "Признак пожара (транспорт)", kind: "single", options: [FLAME, ALARM], showIf: is("where", "Транспорт") },
    { id: "accessTransport", label: "Доступ", kind: "toggle", options: ["Нет доступа"], flag: "noAccess", showIf: is("where", "Транспорт") },
    { id: "transportObject", label: "Транспорт (пламя, дым)", kind: "single", options: TRANSPORT_OBJECTS, showIf: onTransportFlame },
    { id: "threatTransport", label: "Угроза людям", kind: "single", options: YES_NO, flag: "threat", showIf: onTransportFlame },
    { id: "medTransport", label: "Медицинская помощь", kind: "single", options: YES_NO, flag: "med", showIf: onTransportFlame },
    { id: "evacTransport", label: "Требуется эвакуация", kind: "single", options: YES_NO, flag: "evac", showIf: onTransportFlame },
    // Дом
    { id: "fireHouse", label: "Признак пожара (дом)", kind: "single", options: [FLAME, SMELL, ALARM], showIf: is("where", "Дом") },
    { id: "accessHouse", label: "Доступ", kind: "toggle", options: ["Нет доступа"], flag: "noAccess", showIf: is("where", "Дом") },
    { id: "houseKind", label: "Дом (пламя, дым)", kind: "single", options: HOUSE_KINDS, showIf: onHouseFlame },
    { id: "floors", label: "Этажность здания", kind: "text", showIf: onHouseFlame },
    { id: "threatHouse", label: "Угроза людям", kind: "single", options: YES_NO, flag: "threat", showIf: onHouseFlame },
    { id: "houseObject", label: "Внутридомовые объекты (пламя, дым)", kind: "multi", options: HOUSE_OBJECTS, showIf: onHouseFlame },
    { id: "trafficHouse", label: "Есть ли перекрытие движения", kind: "single", options: YES_NO, flag: "traffic", showIf: onHouseFlame },
    { id: "gasHouse", label: "Проведена ли газификация", kind: "single", options: ["Да", "Нет", "Нет данных"], flag: "gas", showIf: onHouseFlame },
    // Здание / объект
    { id: "fireBuilding", label: "Признак пожара (здание)", kind: "single", options: [FLAME, SMELL, ALARM], showIf: is("where", "Здание / объект") },
    { id: "accessBuilding", label: "Доступ", kind: "toggle", options: ["Нет доступа"], flag: "noAccess", showIf: is("where", "Здание / объект") },
    { id: "buildingKind", label: "Здание / объект (пламя, дым)", kind: "single", options: BUILDING_KINDS, showIf: onBuildingFlame },
    { id: "threatBuilding", label: "Угроза людям", kind: "single", options: YES_NO, flag: "threat", showIf: onBuildingFlame },
    { id: "evacBuilding", label: "Требуется эвакуация", kind: "single", options: YES_NO, flag: "evac", showIf: onBuildingFlame },
    // Опасный объект
    { id: "fireDanger", label: "Признак пожара (опасный объект)", kind: "single", options: [FLAME, SMELL, ALARM], showIf: is("where", "Опасный объект") },
    { id: "threatDanger", label: "Угроза людям", kind: "single", options: YES_NO, flag: "threat", showIf: is("where", "Опасный объект") },
    { id: "text", label: "Описание", kind: "text", showIf: { row: "where", answered: true } },
  ],
};

const card104: QuestionCard = {
  key: "104",
  title: "Происшествие 104",
  rows: [
    {
      id: "gasSign",
      label: "Признаки происшествия",
      kind: "single",
      options: [
        "Запах газа вне помещения (на улице)",
        "Запах газа в помещении (в квартире, в доме)",
        "Нарушение в работе газового оборудования",
        "Повреждение газопровода",
        "Повышенное давление газа",
      ],
    },
    { id: "gasThreat", label: "Угроза людям", kind: "single", options: YES_NO, flag: "threat" },
    { id: "text", label: "Описание", kind: "text", showIf: { row: "gasSign", answered: true } },
  ],
};

const card103: QuestionCard = {
  key: "103",
  title: "Происшествие 103",
  rows: [
    {
      id: "place",
      label: "Место",
      kind: "single",
      options: ["Квартира", "Улица", "Общ. место", "Раб. место", "Транспорт", "Метро", "Учебные учреждения", "Дача (СНТ)", "Прочие"],
    },
    { id: "sex", label: "Пол", kind: "single", options: ["Мужчина", "Женщина"] },
    { id: "age", label: "Возраст", kind: "text" },
    { id: "refuse", label: "Отказ", kind: "toggle", options: ["Отказ от реагирования Скорой"], flag: "refusedAmbulance" },
    { id: "threat103", label: "Угроза людям", kind: "single", options: YES_NO, flag: "threat" },
    { id: "med103", label: "Медицинская помощь", kind: "single", options: YES_NO, flag: "med" },
    { id: "text", label: "Описание", kind: "text" },
  ],
};

const cardExplosion: QuestionCard = {
  key: "explosion",
  title: "П: Взрыв",
  rows: [
    {
      id: "whereBoom",
      label: "Где взрыв",
      kind: "single",
      options: ["Здание / Объект", "Транспорт", "Звуки похожие на взрыв, что взорвалось сообщить не может"],
    },
    { id: "boomFire", label: "Есть возгорание", kind: "single", options: YES_NO },
    { id: "boomCollapse", label: "Есть угроза обрушения", kind: "single", options: YES_NO },
    { id: "damage", label: "Какие видят разрушения", kind: "text" },
  ],
};

const cardDtp: QuestionCard = {
  key: "dtp",
  title: "П: ДТП",
  rows: [
    { id: "dtpKind", label: "Вид ДТП", kind: "single", options: ["Столкновение", "Наезд на пешехода", "Наезд на препятствие", "Опрокидывание", "С участием общественного транспорта"] },
    { id: "dtpThreat", label: "Угроза людям", kind: "single", options: YES_NO, flag: "threat" },
    { id: "dtpTraffic", label: "Есть ли перекрытие движения", kind: "single", options: YES_NO, flag: "traffic" },
    { id: "dtpFire", label: "Есть возгорание", kind: "single", options: YES_NO },
    { id: "text", label: "Описание", kind: "text" },
  ],
};

const textOnly = (key: string, title: string): QuestionCard => ({
  key,
  title,
  rows: [{ id: "text", label: "Описание", kind: "text" } satisfies QuestionRow],
});

const CARDS: Record<string, QuestionCard> = { "101": card101, "103": card103, "104": card104, explosion: cardExplosion, dtp: cardDtp };

export function questionCard(key: string): QuestionCard {
  const known = CARDS[key];
  if (known) return known;
  const w = whatHappened(key);
  return textOnly(key, w?.chip ?? key);
}

export function rowVisible(row: QuestionRow, answers: Record<string, string[]>): boolean {
  return !row.showIf || conditionHolds(row.showIf, answers);
}

function conditionHolds(c: RowCondition, answers: Record<string, string[]>): boolean {
  if ("all" in c) return c.all.every((x) => conditionHolds(x, answers));
  const values = answers[c.row] ?? [];
  if ("answered" in c) return values.some((v) => v.trim() !== "");
  return values.some((v) => c.is.includes(v));
}

/** Drop answers of rows that became hidden (e.g. the branch changed from «Улица» to «Дом»). */
export function pruneAnswers(card: QuestionCard, answers: Record<string, string[]>): Record<string, string[]> {
  let current = answers;
  // Hiding a row can hide rows that depend on it, so repeat until stable.
  for (let i = 0; i < 5; i++) {
    const next: Record<string, string[]> = {};
    for (const row of card.rows) {
      const v = current[row.id];
      if (v?.length && rowVisible(row, current)) next[row.id] = v;
    }
    if (Object.keys(next).length === Object.keys(current).length) return next;
    current = next;
  }
  return current;
}
