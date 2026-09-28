import { describe, expect, it } from "vitest";
import { cardErrorFixed, correctedCard, fixLabel, OPERATOR_112_AUTHOR } from "./card-fix";
import type { CardError } from "./scenario";

const entrance: CardError = {
  what: "подъезд",
  inCard: "под. 3",
  onSite: "подъезд 5 (в третьем подъезде всё чисто)",
  report: "в третьем подъезде чисто — дымит в пятом",
  mustSay: [],
  fix: { address: { entrance: "5", code: null }, flags: {} },
};
const victims: CardError = { ...entrance, what: "пострадавшие", inCard: "пострадавших нет", onSite: "есть пострадавший — мужчина с ожогами рук", fix: { address: {}, flags: { victims: true } } };
const card = {
  address: { street: "ул. Берзарина", house: "21", building: "1", entrance: "3", code: "68" },
  flags: { victims: false, gas: true },
  descriptionLog: [{ at: "2026-09-28T05:06:24.000Z", author: "0 УМЦ О.п.", text: "Задымление мусоропровода" }],
};
const now = new Date("2026-09-28T05:23:40.000Z");

describe("the 112 operator corrects an error in the card (customer's answer of 27.09)", () => {
  it("changes the fields of the fix and leaves a line in the card's journal", () => {
    const next = correctedCard(card, entrance, "Поселение Хорошево-Мневники", now);
    expect(next.address).toEqual({ street: "ул. Берзарина", house: "21", building: "1", entrance: "5" }); // the code of the wrong entrance is gone
    expect(next.flags).toEqual({ victims: false, gas: true });
    expect(next.descriptionLog).toHaveLength(2);
    expect(next.descriptionLog[1]).toEqual({
      at: now.toISOString(),
      author: OPERATOR_112_AUTHOR,
      text: "Изменено оператором 112 по звонку диспетчера «Поселение Хорошево-Мневники»: подъезд 5 (в третьем подъезде всё чисто); в карточке было «под. 3».",
    });
    expect(correctedCard(card, victims, "Служба 101", now).flags).toEqual({ victims: true, gas: true });
  });

  it("knows a corrected card by the operator's line, so the correction is made once", () => {
    expect(cardErrorFixed(card.descriptionLog)).toBe(false);
    expect(cardErrorFixed(correctedCard(card, entrance, "Служба 101", now).descriptionLog)).toBe(true);
    expect(cardErrorFixed([{ at: "", author: OPERATOR_112_AUTHOR, text: "Дополнение: жители эвакуированы" }])).toBe(false);
    expect(cardErrorFixed(null)).toBe(false);
  });

  it("says what was corrected in words", () => {
    expect(fixLabel(entrance)).toBe("подъезд 5");
    expect(fixLabel(victims)).toBe("есть пострадавшие");
    expect(fixLabel({ ...entrance, fix: null })).toBe(entrance.onSite);
  });
});
