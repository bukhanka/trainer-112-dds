import { describe, expect, it } from "vitest";
import { decodeLocation, encodeLocation, groupLocations, inLocation, placeLabel } from "./location";
import { inLessonLocation, placeOfStreet, scenarioPlace } from "./place";

describe("location of a scenario", () => {
  it("reads okrug and district from the reference address", () => {
    expect(scenarioPlace({ address: { subject: "Москва", street: "ул. Берзарина", house: "21", district: "Хорошёво-Мнёвники", okrug: "СЗАО" } })).toEqual({
      okrug: "СЗАО",
      district: "Хорошёво-Мнёвники",
      region: null,
    });
  });

  it("completes a bare street by the gazetteer", () => {
    expect(scenarioPlace({ address: { subject: "Москва", street: "улица Рогова", house: "12" } })).toMatchObject({ okrug: "СЗАО", district: "Щукино" });
    // The same name, another kind of street: Коломенская набережная is not Коломенская улица, both in Нагатинский Затон.
    expect(placeOfStreet("Коломенская наб.")).toMatchObject({ district: "Нагатинский Затон" });
    expect(placeOfStreet("ул. Несуществующая")).toBeNull();
  });

  it("tells Московская область and other regions apart from Moscow", () => {
    expect(scenarioPlace({ address: { subject: "Московская область", city: "Королёв" }, inMoscow: false })).toMatchObject({ okrug: "МО", district: null });
    const tula = scenarioPlace({ address: { subject: "Тульская область" }, inMoscow: false });
    expect(tula).toMatchObject({ okrug: null, region: "Тульская область" });
    expect(placeLabel(tula)).toBe("Тульская область");
    // МКАД: Moscow, but no district.
    expect(scenarioPlace({ address: { subject: "Москва", street: "МКАД, 73 км" }, inMoscow: true })).toMatchObject({ okrug: null, district: null });
  });

  it("matches a lesson location by okrug or by district, ignoring ё and case", () => {
    const place = { okrug: "ЮЗАО", district: "Тёплый Стан" };
    expect(inLocation(place, null)).toBe(true);
    expect(inLocation(place, { okrug: "ЮЗАО" })).toBe(true);
    expect(inLocation(place, { okrug: "юзао", district: "Теплый стан" })).toBe(true);
    expect(inLocation(place, { okrug: "ЮЗАО", district: "Коньково" })).toBe(false);
    expect(inLocation({ okrug: null, district: null }, { okrug: "ЮЗАО" })).toBe(false);
  });

  it("round-trips the select value and groups places in the usual order of okrugs", () => {
    expect(decodeLocation(encodeLocation({ okrug: "СЗАО", district: "Щукино" }))).toEqual({ okrug: "СЗАО", district: "Щукино" });
    expect(decodeLocation("ЦАО")).toEqual({ okrug: "ЦАО", district: null });
    expect(decodeLocation("")).toBeNull();
    const groups = groupLocations([
      { okrug: "СЗАО", district: "Щукино" },
      { okrug: "ЦАО", district: "Арбат" },
      { okrug: "СЗАО", district: "Щукино" },
      { okrug: null, district: null },
    ]);
    expect(groups.map((g) => [g.okrug, g.count])).toEqual([
      ["ЦАО", 1],
      ["СЗАО", 2],
    ]);
    expect(groups[1].districts).toEqual([{ name: "Щукино", count: 2 }]);
  });

  it("narrows only what a place draws by itself; tasks by hand go anywhere", () => {
    const pool = [
      { id: "a", truth: { address: { street: "улица Рогова", district: "Щукино", okrug: "СЗАО" } } },
      { id: "b", truth: { address: { street: "улица Арбат", district: "Арбат", okrug: "ЦАО" } } },
    ];
    const location = { okrug: "СЗАО", district: null };
    expect(inLessonLocation(pool, { scenarioIds: [] }, { location }).map((s) => s.id)).toEqual(["a"]);
    expect(inLessonLocation(pool, { scenarioIds: ["b"] }, { location }).map((s) => s.id)).toEqual(["a", "b"]);
    expect(inLessonLocation(pool, { scenarioIds: [] }, { location: null })).toHaveLength(2);
  });
});
