import { describe, expect, it } from "vitest";
import { deriveFlags } from "./card";
import { compareStreets, suggestAddress } from "./gazetteer";
import { mergeManual, routeServices, type ServiceLite } from "./routing";
import type { CardAnswers } from "./types";

const CATALOG: ServiceLite[] = [
  { id: 1, shortName: "Служба 101", kind: "центральная", orderIdx: 1 },
  { id: 3, shortName: "ЦЭМП", kind: "центральная", orderIdx: 3 },
  { id: 4, shortName: "Служба 103", kind: "центральная", orderIdx: 4 },
  { id: 5, shortName: "Служба 104", kind: "центральная", orderIdx: 5 },
  { id: 7, shortName: "ЦОДД", kind: "ведомственная", orderIdx: 7 },
  { id: 33, shortName: "ОАТИ", kind: "ведомственная", orderIdx: 33 },
  { id: 113, shortName: "Служба 102", kind: "центральная", orderIdx: 113 },
  { id: 174, shortName: "Поселение Северное Бутово", kind: "территориальная", subtype: "район (ДДС управы района)", okrug: "ЮЗАО", district: "Северное Бутово", orderIdx: 174 },
  { id: 71, shortName: "Поселение ЮЗАО", kind: "территориальная", subtype: "префектура (ДДС округа)", okrug: "ЮЗАО", district: "ЮЗАО", orderIdx: 71 },
];

const FLAME = "Открытое пламя / Дым";
const names = (ids: { serviceId: number }[]) => ids.map((r) => CATALOG.find((c) => c.id === r.serviceId)?.shortName);

function route(a: CardAnswers, district?: string) {
  const answers = { "101": a };
  const flags = deriveFlags({}, ["101"], answers);
  return routeServices({ cards: ["101"], answers, flags, address: district ? { district, okrug: "ЮЗАО" } : {} }, CATALOG);
}

describe("service routing (screenshots of the customer's workstation)", () => {
  it("street fire without an object gives no plates yet", () => {
    expect(route({ where: ["Улица"], fireStreet: [FLAME] })).toEqual([]);
  });

  it("street fire with rubbish: 101 (main), ЦОДД, ОАТИ", () => {
    const r = route({ where: ["Улица"], fireStreet: [FLAME], streetObject: ["Мусор"] });
    expect(names(r)).toEqual(["Служба 101", "ЦОДД", "ОАТИ"]);
    expect(r[0].isMain).toBe(true);
  });

  it("threat adds ЦЭМП, offence adds 102, gas adds 104", () => {
    const r = route({ where: ["Улица"], fireStreet: [FLAME], streetObject: ["Мусор"], threatStreet: ["Да"], offense: ["Есть правонарушение"], gasStreet: ["Да"] });
    expect(names(r)).toEqual(["Служба 101", "Служба 104", "Служба 102", "ЦЭМП", "ЦОДД", "ОАТИ"]);
  });

  it("smell of burning on the street: only 101", () => {
    expect(names(route({ where: ["Улица"], fireStreet: ["Запах гари"] }))).toEqual(["Служба 101"]);
  });

  it("adds the district and prefecture ДДС once the district is known", () => {
    const r = route({ where: ["Улица"], fireStreet: [FLAME], streetObject: ["Мусор"] }, "Северное Бутово");
    expect(names(r).slice(-2)).toEqual(["Поселение Северное Бутово", "Поселение ЮЗАО"]);
  });

  it("keeps automatic plates and adds manual ones after them", () => {
    const auto = route({ where: ["Улица"], fireStreet: ["Запах гари"] });
    const all = mergeManual(auto, [113, 1, 999], CATALOG);
    expect(names(all)).toEqual(["Служба 101", "Служба 102"]);
    expect(all[1].auto).toBe(false);
  });
});

describe("address suggestions", () => {
  it("fills street, house, district and okrug from one line", () => {
    const [s] = suggestAddress("грина 11");
    expect(s.address).toMatchObject({ street: "улица Грина", house: "11", district: "Северное Бутово", okrug: "ЮЗАО" });
  });

  it("reads corpus and building", () => {
    const [s] = suggestAddress("Берзарина д 21 к1");
    expect(s.address).toMatchObject({ street: "улица Берзарина", house: "21", building: "1", district: "Щукино" });
  });

  it("tells look-alike streets from the same street written differently", () => {
    expect(compareStreets("ул. Грина", "улица Грина")).toBe("same");
    expect(compareStreets("Дубнинская улица", "Дубининская улица")).toBe("lookalike");
    expect(compareStreets("Коломенская улица", "Коломенская набережная")).toBe("lookalike");
    expect(compareStreets("Тверская улица", "улица Грина")).toBe("other");
  });
});
