import { describe, expect, it } from "vitest";
import { mockOpening, mockReply, type Persona } from "./caller";
import { askedTopics, statusOfRole } from "./facts";
import type { CallLine } from "./types";

const persona: Persona = {
  fullName: "Сидорова Анна Викторовна",
  role: "очевидец",
  phone: "+7 (916) 126-34-71",
  visibleAddress: "улица Грина, дом с библиотекой",
  hiddenAddress: "улица Грина, дом 11",
  situation: "Горит балкон на тринадцатом этаже! Открытое пламя.",
  facts: ["Дом 14 этажей.", "Дом газифицирован.", "Пострадавших не видно."],
  temper: "calm",
  voice: "female",
};

const at = "2026-09-26T10:00:00.000Z";
const said = (text: string, revealed: string[]): CallLine => ({ role: "counterpart", text, at, revealed });

describe("rule-based caller", () => {
  it("opens with the situation only", () => {
    const r = mockOpening(persona);
    expect(r.revealed).toEqual(["situation"]);
    expect(r.text).toContain("Горит балкон");
    expect(r.text).not.toContain("Грина");
  });

  it("gives the visible address first and the exact one only on a clarifying question", () => {
    const first = mockReply(persona, [], "Назовите адрес");
    expect(first.text).toContain("дом с библиотекой");
    expect(first.revealed).toEqual(["address"]);

    const again = mockReply(persona, [said(first.text, first.revealed)], "Адрес точнее?");
    expect(again.text).toContain("дом 11");
    expect(again.revealed).toContain("addressExact");

    const direct = mockReply(persona, [], "Какой номер дома?");
    expect(direct.revealed).toContain("addressExact");
  });

  it("tells a fact only when asked about it", () => {
    const gas = mockReply(persona, [], "Дом газифицирован?");
    expect(gas.text).toContain("газифицирован");
    expect(gas.revealed).toEqual(["fact2"]);
    const floors = mockReply(persona, [], "Сколько этажей в доме?");
    expect(floors.revealed).toEqual(["fact1"]);
    expect(floors.text).not.toContain("газ");
  });

  it("answers several questions of one line", () => {
    const r = mockReply(persona, [], "Как вас зовут и ваш телефон для связи?");
    expect(r.revealed).toEqual(expect.arrayContaining(["name", "phone"]));
  });

  it("says it does not know what is not in the ticket", () => {
    const r = mockReply({ ...persona, facts: [] }, [], "Есть угроза людям?");
    expect(r.revealed).toEqual([]);
    expect(r.text).toMatch(/не знаю/i);
  });

  it("thanks the operator when help is on the way", () => {
    expect(mockReply(persona, [], "Помощь выезжает, ожидайте").text).toMatch(/спасибо/i);
  });

  it("speaks in the persona's manner", () => {
    expect(mockOpening({ ...persona, temper: "panic" }).text).toMatch(/Быстрее/);
    expect(mockOpening({ ...persona, temper: "elderly" }).text).toMatch(/Сынок/);
  });
});

describe("topics and statuses", () => {
  it("recognises what the operator asks", () => {
    expect(askedTopics("Уточните, пожалуйста, номер дома")).toContain("addressExact");
    expect(askedTopics("Газ магистральный или баллон?")).toContain("gas");
    expect(askedTopics("Есть пострадавшие?")).toContain("victims");
  });

  it("maps ticket roles to the six caller statuses", () => {
    expect(statusOfRole("мама")).toBe("родственник");
    expect(statusOfRole("супруг")).toBe("родственник");
    expect(statusOfRole("сосед")).toBe("знакомый");
    expect(statusOfRole("очевидец")).toBe("очевидец");
    expect(statusOfRole("вызывает себе")).toBe("пострадавший");
  });
});
