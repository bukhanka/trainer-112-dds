import { describe, expect, it } from "vitest";
import { compareStreets, confusablePairs, lookupAddress, streetKey } from "./address";

describe("ticket addresses", () => {
  it("street and house → district and okrug", () => {
    expect(lookupAddress("улица Грина", "11")).toMatchObject({ district: "Северное Бутово", okrug: "ЮЗАО" });
    expect(lookupAddress("Берзарина ул.", "д. 21")).toMatchObject({ district: "Хорошёво-Мнёвники" });
    expect(lookupAddress("ул. Несуществующая", "1")).toBeNull();
  });

  it("street key drops the kind of street", () => {
    expect(streetKey("ул. Большая Ордынка")).toBe("большая ордынка");
    expect(streetKey("Каширское ш.")).toBe("каширское");
  });
});

describe("look-alike streets", () => {
  it("at least 20 pairs", () => {
    expect(confusablePairs().length).toBeGreaterThanOrEqual(20);
  });

  it("Дубнинская / Дубининская is a critical look-alike", () => {
    const r = compareStreets("Дубнинская улица", "ул. Дубининская");
    expect(r.verdict).toBe("confusable");
    expect(r.verdict === "confusable" && r.pair?.aOkrug).toBe("САО");
  });

  it("same street written differently is not an error", () => {
    expect(compareStreets("Белозерская ул.", "улица Белозерская").verdict).toBe("same");
  });

  it("an unlisted one-letter slip is flagged too, a different street is not", () => {
    expect(compareStreets("ул. Твардовсого", "ул. Твардовского").verdict).toBe("confusable");
    expect(compareStreets("ул. Лескова", "ул. Тихомирова").verdict).toBe("different");
  });
});
