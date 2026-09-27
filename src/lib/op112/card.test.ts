import { describe, expect, it } from "vitest";
import { addressFilled } from "./card";

describe("the questionnaire opens after the address (instruction: «После заполнения формы «Адрес»…»)", () => {
  it("a new card has only the subject «Москва»: the questionnaire stays closed", () => {
    expect(addressFilled({ subject: "Москва" })).toBe(false);
    expect(addressFilled({})).toBe(false);
    expect(addressFilled({ subject: "Москва", street: "   " })).toBe(false);
  });

  it("a street, an object or a descriptive address is a place to go", () => {
    expect(addressFilled({ subject: "Москва", street: "улица Берзарина" })).toBe(true);
    expect(addressFilled({ object: "ТК «Золотой Вавилон»" })).toBe(true);
    expect(addressFilled({ descriptive: "МКАД, внутренняя сторона, 49 км" })).toBe(true);
  });

  it("district and okrug alone, without a street, are not enough", () => {
    expect(addressFilled({ okrug: "СЗАО", district: "Щукино" })).toBe(false);
  });
});
