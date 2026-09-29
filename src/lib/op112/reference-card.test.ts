/** The buttons a careful operator presses for a scenario's leaf, and the rows the caller's answers fill. */
import { describe, expect, it } from "vitest";
import { resolveTree } from "@/lib/routing/tags";
import { panelFor } from "./catalog";
import { answersForLeaf, toldAnswers } from "./reference-card";

describe("the questionnaire of a scenario", () => {
  it("reaches the reference leaf on the hand-made panels, a smoke leaf by its open-flame button", () => {
    const fire = panelFor("101");
    for (const code of [1050201, 1051600, 1010101, 1020101, 1050101]) {
      const answers = answersForLeaf(fire, code)!;
      expect(answers, String(code)).toBeTruthy();
      expect(resolveTree(fire, answers).typeCodes, String(code)).toContain(code);
    }
    const smoke = answersForLeaf(fire, 1050602)!;
    expect(resolveTree(fire, smoke).smokeTypeCodes).toContain(1050602);
    const gas = panelFor("104");
    for (const code of [13020300, 13020100, 13020201]) expect(resolveTree(gas, answersForLeaf(gas, code)!).typeCodes, String(code)).toContain(code);
    expect(answersForLeaf(gas, 1050201)).toBeNull();
  });

  it("fills the rows the caller answered: gas, threat, floors — only rows the panel shows", () => {
    const fire = panelFor("101");
    const balcony = answersForLeaf(fire, 1050201)!;
    const filled = toldAnswers(fire, balcony, { flags: { gas: true, threat: false }, floors: "14" });
    expect(filled).toMatchObject({ gas: ["Да"], threat: ["Нет"], floors: ["14"] });
    const r = resolveTree(fire, filled);
    expect(r.flags).toMatchObject({ gas: true, threat: false });
    // A street fire has no floors row: the floors the caller named stay out of the panel.
    expect(toldAnswers(fire, answersForLeaf(fire, 1010101)!, { flags: {}, floors: "5" }).floors).toBeUndefined();
    const gas = panelFor("104");
    expect(toldAnswers(gas, answersForLeaf(gas, 13020300)!, { flags: {}, gasSource: "Магистральный" }).gasSource).toEqual(["Магистральный"]);
  });
});
