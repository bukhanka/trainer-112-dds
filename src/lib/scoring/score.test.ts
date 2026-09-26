import { describe, expect, it } from "vitest";
import { computeScore, type CriterionResult, type Weights } from "./score";

const weights: Weights = { timeliness: 3, statusOrder: 2, comments: 2, address: 3, services: 3, completeness: 1, literacy: 1 };

const check = (group: CriterionResult["group"], ok: boolean | null, extra: Partial<CriterionResult> = {}): CriterionResult => ({
  code: `${group}.${Math.random()}`,
  group,
  title: group,
  ok,
  source: "rule",
  ...extra,
});

describe("computeScore", () => {
  it("returns null when nothing applies", () => {
    expect(computeScore([check("timeliness", null)], weights)).toBeNull();
  });

  it("weights groups, not individual checks", () => {
    // timeliness 1/1 (w3), comments 0/2 (w2) → 3 / 5 = 60 %
    const score = computeScore([check("timeliness", true), check("comments", false), check("comments", false)], weights);
    expect(score).toBe(60);
  });

  it("leaves «не применимо» out of the denominator", () => {
    expect(computeScore([check("timeliness", true), check("comments", null)], weights)).toBe(100);
  });

  it("caps the score after a critical failure", () => {
    const score = computeScore(
      [check("timeliness", true), check("services", true), check("address", false, { critical: true })],
      weights,
    );
    expect(score).toBeLessThanOrEqual(40);
  });

  it("recomputes with teacher overrides and new weights", () => {
    const c = [check("timeliness", false, { code: "t" }), check("services", true)];
    expect(computeScore(c, weights)).toBe(50);
    expect(computeScore(c, weights, { t: true })).toBe(100);
    expect(computeScore(c, { ...weights, timeliness: 0 })).toBe(100);
  });
});
