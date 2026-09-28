import { describe, expect, it } from "vitest";
import { addressFeed, addressTitle, classLine, fmtDateTime, fmtDuration, fmtLongDate, plateCaption, plateCaptionClass, redialNumber, shortName, tagsLine } from "./format";

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
    expect(addressTitle({ country: "Россия", subject: "Москва", city: "Москва", okrug: "СВАО", district: "Ярославский", object: "парк" })).toBe(
      "Россия, Москва, (СВАО, Ярославский), парк",
    );
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

describe("plate caption", () => {
  it("keeps the part that tells the district ДДС apart", () => {
    expect(plateCaption("Поселение Северное Бутово")).toBe("Северное Бутово");
    expect(plateCaption("Поселение ЮЗАО")).toBe("ЮЗАО");
    expect(plateCaption("101")).toBe("101");
    expect(plateCaption("ГБУ «Жилищник района»")).toBe("ГБУ «Жилищник района»");
  });

  it("fits the longest word whole instead of breaking it", () => {
    expect(plateCaptionClass("Мосжилинспекция")).toContain("text-[10px]");
    expect(plateCaptionClass("Служба 101")).toBe("text-[13px]");
    expect(plateCaptionClass("Северное Бутово")).toBe("text-[11.5px]");
  });

  it("calls a counterpart back from the journal by its phone, a crew without one — by its number", () => {
    expect(redialNumber({ phone: "+7 (916) 000-23-01", crew: "23" })).toBe("+7 (916) 000-23-01");
    expect(redialNumber({ phone: null, crew: "15" })).toBe("15"); // a crew typed by hand, not in the book
    expect(redialNumber({ phone: "112", crew: null })).toBe("112");
    expect(redialNumber({ phone: null, crew: null })).toBeNull();
  });
});
