#!/usr/bin/env python3
"""Build data/services.json: the 211 plates of the «Добавьте службы» window plus hidden listeners.

Usage:
    python3 scripts/build-services.py <services-list.json> [-o data/services.json]

The input is our transcription of the customer's «СЛУЖБЫ 112» screenshots
(fields n, short, full, type, subtype, okrug, district, classifier_col, ...).
This script adds what the trainer needs on top: routing keys (which classifier
column groups a plate serves), delivery, visibility, selection rule, strip order
and the classifier «Главная служба» codes. Decisions are explained in data/README.md.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Plate (by list number) → routing keys from data/classifier.json columns.
ROUTE_KEYS: dict[int, list[str]] = {
    1: ["s101", "ods_psc"],  # Служба 101 = МЧС + ОДС ПСЦ (one plate on the card)
    2: ["fsb"],
    3: ["cemp"],
    4: ["smp"],
    5: ["mosgaz"],
    7: ["codd"],
    8: ["gormost"],
    9: ["mosgortrans"],
    10: ["autoroads"],
    11: ["mosvodokanal"],
    12: ["moesk"],
    13: ["moek"],
    14: ["gkh_dep", "city_economy"],  # grey «Деп. ЖКХ» plate: column «Деп. ЖКХ» + «Гор. Хозяйство»
    15: ["metro"],
    17: ["mosbez"],
    19: ["rsvo"],
    20: ["oek"],
    21: ["moslift"],
    22: ["mosvodostok"],
    23: ["moscollector"],
    24: ["military_command"],
    33: ["oati"],
    34: ["msppn"],
    56: ["rzd"],
    76: ["dep_education"],
    95: ["dep_nature"],
    113: ["mvd"],
    116: ["mgts"],
    149: ["canal"],
    152: ["dep_social"],
    160: ["evazhd"],
    188: ["water_basin"],
    192: ["mosoblgaz"],
    206: ["dep_culture"],
    207: ["csa"],
    208: ["tourism"],
    209: ["dep_construction"],
    210: ["vet"],
    211: ["housing_inspection"],
}
OKRUG_ROADS = range(196, 206)  # «ГБУ АД <округ>» share the «Автомобильные дороги АО» column

# Classifier column M («Главная служба») → plate.
MAIN_CODES: dict[int, list[str]] = {
    1: ["MCHS"],
    113: ["Police"],
    4: ["AMBULANCE"],
    5: ["MOSGAZ"],
    21: ["MOSLIFT"],
    10: ["AUTOROADS"],
    11: ["MOSVODOCANAL"],
    15: ["METRO"],
    20: ["OEK"],
    9: ["MOSGORTRANS"],
    12: ["MOESK"],
    13: ["MOEK"],
    56: ["MZD"],
    116: ["MGTS"],
    22: ["MOSVODOSTOK"],
    23: ["MOSCOLLECTOR"],
    8: ["GORMOST"],
    14: ["GKH"],
    152: ["Dep.tszn"],
    7: ["ZODD"],
    34: ["MSPPN"],
    95: ["DepEco"],
    3: ["ZEMP"],
}

# Services that get the card through an external integrated system (not the 112 workstation).
VIS = {1, 4, 5, 7, 11, 113, 18, 57}
# Grey plate on the card: notified by phone only.
PHONE = {14}

SELECT_RULE: dict[int, str] = {
    14: "street_needs_district",
    192: "tinao_only",
    18: "region:Московская область",
    57: "region:Калужская область",
    6: "manual",
    16: "manual",
    185: "manual",
}

# Order of plates in the card strip (lower first). Taken from the customer's screenshots:
# 101, 104, 102, Деп. ЖКХ, ЦЭМП, ЦОДД, Мосгортранс, Мос.Без., Мослифт, ОАТИ.
STRIP_ORDER = [1, 5, 113, 4, 14, 3, 2, 7, 9, 17, 21, 33]

KIND = {"неясно": "прочая"}
CLASSIFIER_COL = {14: "BD, AO (Гор. Хозяйство)"}

# Classifier columns without a line in the window: they receive cards but are never shown.
LISTENERS: list[dict] = [
    {"shortName": "МГПСС", "fullName": "ГКУ «Московская городская поисково-спасательная служба на водных объектах»", "routeKeys": ["mgpss"]},
    {"shortName": "Росгвардия", "fullName": "ГУ Росгвардии по г. Москве", "routeKeys": ["rosgvardia"]},
    {"shortName": "Аппарат Мэра", "fullName": "Аппарат Мэра и Правительства Москвы", "routeKeys": ["mayor_office"]},
    {"shortName": "ГКУ НТУ", "fullName": "ГКУ НТУ", "routeKeys": ["ntu"]},
    {"shortName": "ФСО", "fullName": "Федеральная служба охраны", "routeKeys": ["fso"]},
    {"shortName": "ЦУКБ МО", "fullName": "ЦУКБ Министерства обороны", "routeKeys": ["cukb_mo"]},
    {"shortName": "ЦУКБ.БПЛА", "fullName": "ЦУКБ Министерства обороны (БПЛА)", "routeKeys": ["cukb_uav"]},
    {"shortName": "ДТУ", "fullName": "ДТУ", "routeKeys": ["dtu"]},
    {"shortName": "ДТУ Ритуал", "fullName": "ДТУ_Р (Ритуал)", "routeKeys": ["dtu_ritual"]},
    {"shortName": "ГУП МСР", "fullName": "ГУП МСР (КУБ, пожары)", "routeKeys": ["gup_msr_kub", "gup_msr_fire"], "mainCodes": ["МСР"]},
    {"shortName": "ДГП", "fullName": "Департамент градостроительной политики", "routeKeys": ["dgp_integration", "dgp_arm"]},
    {"shortName": "Организатор перевозок", "fullName": "ГКУ «Организатор перевозок»", "routeKeys": ["transport_organizer"]},
    {"shortName": "Мосэкомониторинг", "fullName": "ГПБУ «Мосэкомониторинг»", "routeKeys": ["ecomonitoring"]},
    {"shortName": "МО РХБЗ", "fullName": "Министерство обороны, войска РХБЗ", "routeKeys": ["mo_rhbz_polygons", "mo_rhbz_moscow"]},
    {"shortName": "Ситиэнерго", "fullName": "ООО «Ситиэнерго»", "routeKeys": ["cityenergo"]},
    {"shortName": "Деп. гражд. строительства", "fullName": "Департамент гражданского строительства", "routeKeys": ["dep_civil_construction"]},
    {"shortName": "Мос.Без. аналитика", "fullName": "ГКУ МОСБЕЗ: МКП, аналитика", "routeKeys": ["mosbez_analytics"]},
]
LISTENER_FIRST_ID = 1001


def build(src: list[dict]) -> list[dict]:
    services = []
    for s in src:
        n = s["n"]
        kind = KIND.get(s["type"], s["type"])
        territorial = kind == "территориальная"
        is_prefecture = territorial and "префектур" in (s.get("subtype") or "")
        okrug = s.get("okrug")
        route_keys = list(ROUTE_KEYS.get(n, []))
        rule = SELECT_RULE.get(n)
        if territorial:
            route_keys = ["territorial_tinao" if okrug == "ТиНАО" else "territorial"]
            rule = "prefecture" if is_prefecture else "district"
        elif n in OKRUG_ROADS:
            route_keys = ["okrug_roads"]
            rule = "okrug"
            okrug = s["short"].replace("ГБУ АД ", "").strip()
        if n in STRIP_ORDER:
            order = (STRIP_ORDER.index(n) + 1) * 10
        elif territorial:
            order = (4000 if is_prefecture else 3000) + n
        else:
            order = 1000 + n
        services.append(
            {
                "id": n,
                "shortName": s["short"],
                "fullName": s.get("full") or s["short"],
                "kind": kind,
                "subtype": s.get("subtype") if s.get("subtype") not in (None, "—") else None,
                "classifierCol": CLASSIFIER_COL.get(n, s.get("classifier_col")),
                "routeKeys": route_keys,
                "delivery": "VIS" if n in VIS else "PHONE" if n in PHONE else "ARM112",
                "visible": True,
                "okrug": okrug,
                "district": None if is_prefecture else s.get("district"),
                "selectRule": rule,
                "phone": None,
                "orderIdx": order,
                "mainCodes": MAIN_CODES.get(n, []),
            }
        )
    for i, extra in enumerate(LISTENERS):
        services.append(
            {
                "id": LISTENER_FIRST_ID + i,
                "shortName": extra["shortName"],
                "fullName": extra["fullName"],
                "kind": "слушатель",
                "subtype": "получает карточку, в полосе служб не показывается",
                "classifierCol": None,
                "routeKeys": extra["routeKeys"],
                "delivery": "ARM112",
                "visible": False,
                "okrug": None,
                "district": None,
                "selectRule": None,
                "phone": None,
                "orderIdx": 9000 + i,
                "mainCodes": extra.get("mainCodes", []),
            }
        )
    return services


def check(services: list[dict]) -> None:
    classifier = json.loads((ROOT / "data" / "classifier.json").read_text(encoding="utf-8"))
    column_keys = {c["routeKey"] for c in classifier["columns"]}
    served = {k for s in services for k in s["routeKeys"]}
    missing = column_keys - served
    unknown = served - column_keys
    if missing or unknown:
        sys.exit(f"routing keys without a plate: {sorted(missing)}; plates with unknown keys: {sorted(unknown)}")
    codes = {c.strip() for t in classifier["types"] for c in (t["mainService"] or "").split(",") if c.strip()}
    mapped = {c for s in services for c in s["mainCodes"]}
    if codes - mapped:
        sys.exit(f"main service codes without a plate: {sorted(codes - mapped)}")
    ids = [s["id"] for s in services]
    if len(ids) != len(set(ids)):
        sys.exit("duplicate service ids")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", type=Path)
    ap.add_argument("-o", "--out", type=Path, default=ROOT / "data" / "services.json")
    args = ap.parse_args()
    src = json.loads(args.source.read_text(encoding="utf-8"))
    services = build(src)
    check(services)
    lines = ",\n".join(json.dumps(s, ensure_ascii=False, separators=(",", ":")) for s in services)
    args.out.write_text("[\n" + lines + "\n]\n", encoding="utf-8")
    visible = sum(s["visible"] for s in services)
    print(f"{args.out}: {len(services)} services ({visible} visible, {len(services) - visible} listeners)")


if __name__ == "__main__":
    main()
