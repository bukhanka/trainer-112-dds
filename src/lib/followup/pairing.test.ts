import { describe, expect, it } from "vitest";
import { commonOptions, hasPair, pairProblem, type CaseOption } from "./pairing";

const option = (id: string, difficulty: number, extra: Partial<CaseOption> = {}): CaseOption => ({
  id, title: id, difficulty, keys: [`situation:${id.replace(/-ош$/, "")}`], group: null, marked: false, seen: false, ...extra,
});

describe("practice and control pair", () => {
  it("never makes the control the same situation as the practice, a ticket's «-ош» variant included", () => {
    expect(pairProblem("OP112", option("Б5-1", 6), option("Б5-1", 6))).toMatch(/другой ситуацией/);
    expect(pairProblem("DDS", option("Б5-1", 6), option("Б5-1-ош", 7))).toMatch(/другой ситуацией/);
    expect(pairProblem("DDS", option("Б5-1", 6), option("Б17-1", 3))).toBeNull();
  });

  it("keeps a 112 control close in difficulty to the practice; a ДДС card is judged on the same work", () => {
    expect(pairProblem("OP112", option("a", 7), option("b", 5))).toBeNull();
    expect(pairProblem("OP112", option("a", 7), option("b", 4))).toMatch(/не больше чем на 2/);
    expect(pairProblem("DDS", option("a", 7), option("b", 3))).toBeNull();
  });

  it("respects the methodologist's groups of comparable cases", () => {
    expect(pairProblem("OP112", option("a", 5, { group: "x" }), option("b", 5, { group: "y" }))).toMatch(/разным группам/);
    expect(pairProblem("OP112", option("a", 5, { group: "x" }), option("b", 5, { group: "x" }))).toBeNull();
    expect(pairProblem("OP112", option("a", 5, { group: "x" }), option("b", 5))).toBeNull();
  });

  it("finds whether any pair exists at all", () => {
    expect(hasPair("OP112", { practice: [option("a", 5)], control: [option("a", 5)] })).toBe(false);
    expect(hasPair("OP112", { practice: [option("a", 5)], control: [option("a", 5), option("b", 6)] })).toBe(true);
  });
});

describe("one case for a group", () => {
  it("offers only what suits every chosen student and marks a case seen by anyone", () => {
    const first = [option("a", 5), option("b", 5, { seen: true }), option("c", 5)];
    const second = [option("b", 5), option("c", 5, { seen: true })];
    expect(commonOptions([first, second]).map((o) => [o.id, o.seen])).toEqual([["b", true], ["c", true]]);
    expect(commonOptions([first, []])).toEqual([]);
    expect(commonOptions([])).toEqual([]);
  });
});
