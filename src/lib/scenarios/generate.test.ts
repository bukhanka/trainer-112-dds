import { describe, expect, it } from "vitest";
import { matchType, readByRules } from "./generate";

const row = (code: number, finalType: string, sign1 = "", sign2 = "", sign3 = "") => ({
  code,
  groupId: Math.floor(code / 1_000_000),
  finalType,
  sign1,
  sign2,
  sign3,
  questions: [],
  hiddenFromOperator: false,
});

const TYPES = [
  row(1010101, "пожар: мусор", "на улице", "мусор", "открытое пламя"),
  row(1040501, "пожар: мусоропровод", "в доме", "мусоропровод", "открытое пламя"),
  row(1040101, "пожар: квартира", "в доме", "квартира", "открытое пламя"),
  row(2010000, "ДТП без пострадавших"),
  row(2020000, "ДТП с пострадавшими"),
  row(15060201, "Драка на улице", "Драка", "Улица общественное место"),
  row(15060100, "Драка в квартире", "Драка", "Квартира"),
  row(13020100, "Запах бытового газа в многоквартирном доме"),
];

const typeOf = (text: string) => {
  const ex = readByRules(text);
  return matchType(TYPES, ex.typeHint, text)?.finalType;
};

describe("scenario from text, rules only", () => {
  it("reads the flags only when the text says so", () => {
    const ex = readByRules("Горит квартира, в квартире остался ребёнок. Дом газифицирован.");
    expect(ex.flags).toMatchObject({ threat: true, gas: true });
    expect(ex.flags.victims).toBeUndefined();
  });

  it("finds the street and the house", () => {
    const ex = readByRules("Во дворе дерутся трое, Бульвар Маршала Рокоссовского, 25.");
    expect(ex.address.street).toMatch(/Маршала Рокоссовского/);
    expect(ex.address.house).toBe("25");
  });

  it("does not take a crossroads for a traffic block or a house number for a crowd", () => {
    const ex = readByRules("На перекрёстке, дом 25, дерутся трое");
    expect(ex.flags.traffic).toBeUndefined();
    expect(ex.typeHint).toBe("драка на улице");
  });

  it("maps to the classifier leaf", () => {
    expect(typeOf("Возгорание мусорного контейнера во дворе")).toBe("пожар: мусор");
    expect(typeOf("Задымление мусоропровода в подъезде")).not.toBe("пожар: квартира");
    expect(typeOf("Горит квартира на 5 этаже")).toBe("пожар: квартира");
    expect(typeOf("Столкнулись две машины, водитель без сознания")).toBe("ДТП с пострадавшими");
    expect(typeOf("Столкнулись две машины, все целы")).toBe("ДТП без пострадавших");
    expect(typeOf("Соседи дерутся в квартире")).toBe("Драка в квартире");
    expect(typeOf("В подъезде сильно пахнет газом")).toBe("Запах бытового газа в многоквартирном доме");
  });
});

describe("facts from the text", () => {
  it("does not break a sentence on «ул.»", () => {
    const ex = readByRules("Горит квартира. Звонит соседка, ул. Грина, 11. Дом газифицирован.");
    expect(ex.caller.facts).toEqual(["Звонит соседка, ул. Грина, 11.", "Дом газифицирован."]);
  });
});
