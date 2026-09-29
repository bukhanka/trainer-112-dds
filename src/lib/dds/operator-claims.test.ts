import { describe, expect, it } from "vitest";
import { operatorMockReply, type OperatorState } from "./personas";
import { claimsAction, claimsCardEdit, PASS_ON, settleOperatorLine } from "./operator-claims";

const fixed: OperatorState = { kind: "fixed", card: 36815068, label: "пострадавшие: есть" };
const fixedLine = operatorMockReply("Карточка 36815068, есть пострадавший", 2, fixed);
const none = operatorMockReply("Карточка 36815068, улица Грина, дом 11, обстановка изменилась", 2, { kind: "none", card: 36815068 });

describe("the 112 operator says only what the trainer does", () => {
  it("the jury's case: the card was corrected, «Пожарных продублировал» was not — that sentence goes, «передам» comes", () => {
    const model =
      "Принято, информацию поменял: есть пострадавший, мужчина с ожогами. Пожарных продублировал. Службы видят изменения в карточке.";
    const said = settleOperatorLine(model, true, fixedLine);
    expect(said).toBe(`Принято, информацию поменял: есть пострадавший, мужчина с ожогами. ${PASS_ON} Службы видят изменения в карточке.`);
    expect(said).not.toMatch(/продублир/i);
  });

  it("no dispatch done or promised: sent, re-sent, called, notified, on the way", () => {
    for (const line of [
      "Бригаду направил повторно.",
      "Скорую вызвал, едут.",
      "Службы переоповестил.",
      "Наряд уже в пути.",
      "Информацию передал в полицию.",
      "Сейчас продублирую пожарным.",
      "Направлю к вам ещё одну бригаду.",
    ]) {
      expect(claimsAction(line), line).toBe(true);
      const said = settleOperatorLine(`Принято. ${line}`, true, fixedLine);
      expect(claimsAction(said), said).toBe(false);
      expect(said).toContain("передам");
    }
    for (const line of ["Принял, передам старшему смены.", "Уточню у старшего смены.", "Назовите номер карточки.", "Исправлю, как только назовёте верные сведения."]) {
      expect(claimsAction(line), line).toBe(false);
    }
  });

  it("before the card is corrected a change in the card is not claimed: the rule-based line is said", () => {
    const said = settleOperatorLine("Всё, исправил, службы видят изменения.", false, none);
    expect(said).toBe(none);
    expect(claimsCardEdit(said)).toBe(false);
    // …and a dispatch in the same line does not come back with it.
    const both = settleOperatorLine("Карточку обновил, пожарных направил.", false, none);
    expect(both).toBe(none);
    expect(claimsAction(both)).toBe(false);
  });

  it("a claim goes by its clause, the true part of the sentence stays", () => {
    expect(settleOperatorLine("Принято, данные обновил, службы переоповестил. Всего доброго.", true, fixedLine)).toBe(
      `Принято, данные обновил. ${PASS_ON} Всего доброго.`,
    );
    expect(settleOperatorLine("Исправил подъезд и направил бригаду.", true, fixedLine)).toBe(`Исправил подъезд. ${PASS_ON}`);
  });

  it("a line with nothing but a claim becomes the rule-based line of the moment, with «передам»", () => {
    const said = settleOperatorLine("Пожарных продублировал.", true, fixedLine);
    expect(said.startsWith(fixedLine)).toBe(true);
    expect(said.endsWith(PASS_ON)).toBe(true);
  });

  it("an honest line stays as the model said it", () => {
    const honest = "Принято. В карточке исправил: есть пострадавший. В журнале отметка, службы видят изменение.";
    expect(settleOperatorLine(honest, true, fixedLine)).toBe(honest);
    expect(settleOperatorLine("Принял, передам старшему смены.", false, none)).toBe("Принял, передам старшему смены.");
  });
});
