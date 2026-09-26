/**
 * Service selection against the customer's materials: the clicks recorded on the 112
 * workstation screenshots («КАРТОЧКА 112», table A5 of our analysis) and the customer's
 * example from the chat. Where the data and a screenshot disagree, the test pins the
 * data behaviour and the gap is described in data/README.md.
 */
import { describe, expect, it } from "vitest";
import { selectServices, activeConditions, normalizeDistrict, normalizeOkrug, type RoutingInput } from "./engine";
import { loadJsonReference } from "./reference-json";

const ref = loadJsonReference();
const nameOf = new Map(ref.services.map((s) => [s.id, s.shortName]));

const T = {
  garbage: 1010101, // пожар: мусор (Улица · Открытое пламя · Мусор)
  burningSmellStreet: 1011100, // запах гари на улице
  bus: 1020101, // пожар: автобус (Транспорт · Общественный транспорт)
  flat: 1050101, // пожар: квартира (Дом · многоквартирный · Квартира)
  gasHeater: 1050301, // пожар: газовая колонка
  entrance: 1050701, // пожар: подъезд
  school: 1060101, // Пожар: учебное заведение
  gasPrivateHouse: 13020300, // Запах бытового газа в частном доме
};

function plates(input: RoutingInput, includeHidden = false): string[] {
  return selectServices(input, ref, { includeHidden }).map((s) => nameOf.get(s.serviceId) ?? String(s.serviceId));
}

describe("street fire (screenshots: Улица · Открытое пламя / Дым)", () => {
  it("no incident type chosen yet — no services", () => {
    expect(plates({ typeCodes: [], flags: { noAccess: true } })).toEqual([]);
  });

  it("garbage with «Нет доступа» → 101, ЦОДД, ОАТИ", () => {
    expect(plates({ typeCodes: [T.garbage], flags: { noAccess: true } })).toEqual(["Служба 101", "ЦОДД", "ОАТИ"]);
  });

  it("garbage without «Нет доступа» gives the same plates", () => {
    expect(plates({ typeCodes: [T.garbage] })).toEqual(["Служба 101", "ЦОДД", "ОАТИ"]);
  });

  it("+ угроза людям → + ЦЭМП; «Нет» removes it again", () => {
    expect(plates({ typeCodes: [T.garbage], flags: { noAccess: true, threat: true } })).toEqual([
      "Служба 101",
      "ЦЭМП",
      "ЦОДД",
      "ОАТИ",
    ]);
    expect(plates({ typeCodes: [T.garbage], flags: { noAccess: true, threat: false } })).toEqual([
      "Служба 101",
      "ЦОДД",
      "ОАТИ",
    ]);
  });

  it("+ правонарушение → + Служба 102 (screenshot with тоннель, угроза, правонарушение)", () => {
    expect(
      plates({ typeCodes: [T.garbage], flags: { noAccess: true, threat: true, offense: true, tunnel: true } }),
    ).toEqual(["Служба 101", "Служба 102", "ЦЭМП", "ЦОДД", "ОАТИ"]);
  });

  it("мед. помощь / эвакуация when ЦЭМП is already there change nothing", () => {
    expect(
      plates({ typeCodes: [T.garbage], flags: { noAccess: true, threat: true, offense: true, med: true, evac: true } }),
    ).toEqual(["Служба 101", "Служба 102", "ЦЭМП", "ЦОДД", "ОАТИ"]);
  });

  it("+ газификация → + Служба 104, order 101, 104, 102, ЦЭМП, ЦОДД, ОАТИ", () => {
    expect(
      plates({ typeCodes: [T.garbage], flags: { noAccess: true, threat: true, offense: true, gas: true } }),
    ).toEqual(["Служба 101", "Служба 104", "Служба 102", "ЦЭМП", "ЦОДД", "ОАТИ"]);
  });

  it("запах гари → only Служба 101, whatever else is marked", () => {
    expect(plates({ typeCodes: [T.burningSmellStreet], flags: { noAccess: true, crossing: true } })).toEqual([
      "Служба 101",
    ]);
    expect(plates({ typeCodes: [T.burningSmellStreet], flags: { tunnel: true } })).toEqual(["Служба 101"]);
  });
});

describe("transport fire (screenshot: Транспорт · Общественный транспорт)", () => {
  it("with «Нет доступа» → 101, 102, Деп. ЖКХ, ЦОДД, Мосгортранс, Мос.Без., ОАТИ", () => {
    expect(plates({ typeCodes: [T.bus], flags: { noAccess: true } })).toEqual([
      "Служба 101",
      "Служба 102",
      "Деп. ЖКХ",
      "ЦОДД",
      "Мосгортранс",
      "Мос.Без.",
      "ОАТИ",
    ]);
  });

  it("+ угроза людям → + ЦЭМП", () => {
    expect(plates({ typeCodes: [T.bus], flags: { noAccess: true, threat: true } })).toEqual([
      "Служба 101",
      "Служба 102",
      "Деп. ЖКХ",
      "ЦЭМП",
      "ЦОДД",
      "Мосгортранс",
      "Мос.Без.",
      "ОАТИ",
    ]);
  });

  it("Деп. ЖКХ is a grey (phone-only) plate", () => {
    const svc = ref.services.find((s) => s.shortName === "Деп. ЖКХ");
    expect(svc?.routeKeys).toEqual(["gkh_dep", "city_economy"]);
  });
});

describe("house fire (screenshot: Дом · многоквартирный)", () => {
  it("квартира + газификация + угроза → strip starts exactly as on the screenshot", () => {
    const got = plates({ typeCodes: [T.flat], flags: { gas: true, threat: true } });
    // The screenshot shows eight plates and a «more» arrow; the data adds ОАТИ, ЭВАЖД, Мосжилинспекция after them.
    expect(got.slice(0, 8)).toEqual([
      "Служба 101",
      "Служба 104",
      "Служба 102",
      "Деп. ЖКХ",
      "ЦЭМП",
      "ЦОДД",
      "Мос.Без.",
      "Мослифт",
    ]);
    expect(got.slice(8)).toEqual(["ОАТИ", "ЭВАЖД", "Мосжилинспекция"]);
  });

  it("квартира + газовая колонка + подъезд without flags: 104 comes from the gas heater leaf", () => {
    // On the screenshot ЦЭМП is also present; by the classifier ЦЭМП needs угроза / пострадавшие / мед. помощь / эвакуация.
    expect(plates({ typeCodes: [T.flat, T.gasHeater, T.entrance] })).toEqual([
      "Служба 101",
      "Служба 104",
      "Служба 102",
      "Деп. ЖКХ",
      "ЦОДД",
      "Мос.Без.",
      "Мослифт",
      "ОАТИ",
      "ЭВАЖД",
      "Мосжилинспекция",
    ]);
  });

  it("«Нет доступа» never drops Служба 101 for a flat fire", () => {
    expect(plates({ typeCodes: [T.flat], flags: { noAccess: true } })[0]).toBe("Служба 101");
  });
});

describe("customer example: fire in a school in Щукино with victims", () => {
  const input: RoutingInput = { typeCodes: [T.school], flags: { victims: true }, district: "Щукино" };

  it("has everything the customer named: 01, 02, 03, ЦЭМП, Деп. образования, ДДС Щукино, ДДС СЗАО", () => {
    const got = plates(input);
    for (const name of ["Служба 101", "Служба 102", "Служба 103", "ЦЭМП", "Деп. Обр.", "Поселение Щукино", "Поселение СЗАО"]) {
      expect(got).toContain(name);
    }
  });

  it("full list by the classifier row «Пожар: учебное заведение»", () => {
    expect(plates(input)).toEqual([
      "Служба 101",
      "Служба 102",
      "Служба 103",
      "Деп. ЖКХ",
      "ЦЭМП",
      "ФСБ",
      "ЦОДД",
      "Мос.Без.",
      "ОАТИ",
      "ОЭК",
      "Деп. Обр.",
      "Поселение Щукино",
      "Поселение СЗАО",
    ]);
  });

  it("main service goes first and is marked", () => {
    const [first] = selectServices(input, ref);
    expect(nameOf.get(first.serviceId)).toBe("Служба 101");
    expect(first.isMain).toBe(true);
  });

  it("without victims there is no 103 and 102 still comes («признак не выбран»)", () => {
    const got = plates({ ...input, flags: {} });
    expect(got).not.toContain("Служба 103");
    expect(got).toContain("Служба 102");
  });
});

describe("territorial services", () => {
  it("appear only when the address is resolved to the district", () => {
    expect(plates({ typeCodes: [T.garbage], okrug: "ЦАО" })).not.toContain("Поселение ЦАО");
    expect(plates({ typeCodes: [T.garbage], district: "Басманный" })).toEqual([
      "Служба 101",
      "Деп. ЖКХ",
      "ЦОДД",
      "ОАТИ",
      "Поселение Басманный",
      "Поселение ЦАО",
    ]);
  });

  it("district names are matched loosely: «район Преображенское», «Бирюлёво Восточное»", () => {
    expect(plates({ typeCodes: [T.garbage], district: "район Преображенское" })).toContain("Поселение Преображенский");
    expect(plates({ typeCodes: [T.garbage], district: "Бирюлёво Восточное" })).toContain("Поселение ЮАО");
  });

  it("ТиНАО: settlement + prefecture ТиНАО, Мособлгаз joins gas cards (ticket 30-3, Вороновское)", () => {
    expect(plates({ typeCodes: [T.gasPrivateHouse], district: "Вороновское" })).toEqual([
      "Служба 104",
      "Служба 101",
      "ЦЭМП",
      "Мособлгаз",
      "Поселение Вороновское",
      "Поселение ТиНАО",
    ]);
  });

  it("Мособлгаз is not added inside old Moscow", () => {
    expect(plates({ typeCodes: [T.gasPrivateHouse], district: "Щукино" })).not.toContain("Мособлгаз");
  });

  it("address in the Moscow region: no territorial ДДС, the region's 112 is suggested", () => {
    const got = plates({ typeCodes: [T.garbage], region: "Московская область" });
    expect(got).toContain("112 Мос. обл.");
    expect(got.some((n) => n.startsWith("Поселение"))).toBe(false);
  });

  it("other regions: no territorial ДДС and no neighbour 112", () => {
    const got = plates({ typeCodes: [T.garbage], region: "Волгоградская область" });
    expect(got.some((n) => n.startsWith("Поселение") || n.startsWith("112"))).toBe(false);
  });

  it("ГБУ Автодороги of the okrug join road types", () => {
    const roadType = [...ref.types.values()].find((t) => t.routes.some((r) => r.routeKey === "okrug_roads"));
    expect(roadType).toBeDefined();
    const got = plates({ typeCodes: [roadType!.code], district: "Щукино" });
    expect(got).toContain("ГБУ АД СЗАО");
    expect(got).not.toContain("ГБУ АД ЦАО");
  });
});

describe("listeners and helpers", () => {
  it("hidden listeners are returned only on request", () => {
    expect(plates({ typeCodes: [T.garbage] })).not.toContain("Аппарат Мэра");
    expect(plates({ typeCodes: [T.garbage] }, true)).toContain("Аппарат Мэра");
  });

  it("gas card has 104 as the main service in front of 101", () => {
    const [first] = selectServices({ typeCodes: [T.gasPrivateHouse] }, ref);
    expect(nameOf.get(first.serviceId)).toBe("Служба 104");
    expect(first.isMain).toBe(true);
  });

  it("reasons explain the condition", () => {
    const got = selectServices({ typeCodes: [T.garbage], flags: { threat: true } }, ref);
    const cemp = got.find((s) => nameOf.get(s.serviceId) === "ЦЭМП");
    expect(cemp?.reason).toBe("пожар: мусор — угроза людям");
  });

  it("flag helpers", () => {
    expect([...activeConditions({ refusedAmbulance: true, objectList: true })].sort()).toEqual([
      "object_list",
      "victims_absent",
    ]);
    expect(normalizeOkrug("Северо-Западный административный округ")).toBe("СЗАО");
    expect(normalizeOkrug("НАО")).toBe("ТиНАО");
    expect(normalizeOkrug("Троицкий и Новомосковский административные округа")).toBe("ТиНАО");
    expect(normalizeDistrict("поселение Вороновское")).toBe("вороновское");
  });

  it("every classifier routing key is served by some plate", () => {
    const served = new Set(ref.services.flatMap((s) => s.routeKeys));
    const keys = new Set([...ref.types.values()].flatMap((t) => t.routes.map((r) => r.routeKey)));
    expect([...keys].filter((k) => !served.has(k))).toEqual([]);
  });
});
