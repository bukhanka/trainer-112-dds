import { describe, expect, it } from "vitest";
import { addressFeed, addressTitle, classLine, fmtDateTime, fmtDuration, fmtLongDate, shortName, tagsLine } from "./format";

describe("format", () => {
  it("prints dates in Moscow time like the customer's system", () => {
    const d = new Date("2026-09-17T08:13:19Z"); // 11:13:19 MSK
    expect(fmtDateTime(d)).toBe("17.09.2026 11:13:19");
    expect(fmtLongDate(d)).toBe("Четверг, 17 Сентябрь 2026");
    expect(fmtDuration(42)).toBe("0:42");
    expect(fmtDuration(605)).toBe("10:05");
  });

  it("builds the address lines", () => {
    const a = { country: "Россия", city: "Москва", okrug: "ТАО", district: "Вороновское", street: "пос. ЛМС", house: "20", descriptive: "частный дом" };
    expect(addressTitle(a)).toBe("Россия, Москва, (ТАО, Вороновское), пос. ЛМС, д. 20");
    expect(addressFeed(a)).toBe("Москва , (ТАО, Вороновское) , пос. ЛМС, д. 20 , частный дом");
    expect(addressTitle(null)).toBe("");
  });

  it("joins tags of one row with commas and rows with dots", () => {
    const line = tagsLine([
      { row: "Место", value: "Дом" },
      { row: "Признаки", value: "Открытое пламя / Дым (дом)" },
      { row: "Признаки", value: "Запах гари (дом)" },
      { row: "Помещение", value: "квартира" },
    ]);
    expect(line).toBe("Дом . Открытое пламя / Дым (дом), Запах гари (дом) . квартира .");
    expect(classLine(["пожар: квартира"])).toBe("пожар: квартира ;");
  });

  it("shortens a full name for status authors", () => {
    expect(shortName("Иванов Алексей Сергеевич")).toBe("Иванов А С");
  });
});
