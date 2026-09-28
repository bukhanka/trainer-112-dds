import { describe, expect, it } from "vitest";
import { computeScore, CRITICAL_CAP, TIME_ZERO_AT, timeCredit, timePoints, timePointsLine, timeZeroAt, type CriterionResult, type Weights } from "./score";

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

describe("time past the norm: fewer points the longer, not all or nothing", () => {
  // The 112 typing norm of the lesson: 65 s. Only the time check fails — the rest of the card is right.
  const late = (sec: number): CriterionResult[] => [
    check("timeliness", sec <= 65, { code: "op112.typing_time", timing: { sec, normSec: 65 } }),
    check("address", true),
    check("services", true),
    check("completeness", true),
    check("literacy", true),
  ];

  it("gives all the points within the norm and none at twice the norm, linearly in between", () => {
    expect(timeCredit(40, 65)).toBe(1);
    expect(timeCredit(65, 65)).toBe(1);
    expect(timeCredit(66, 65)).toBeCloseTo(64 / 65);
    expect(timeCredit(98, 65)).toBeCloseTo(0.49, 2);
    expect(timeCredit(130, 65)).toBe(0);
    expect(timeCredit(195, 65)).toBe(0);
    // Another zero point: at three norms 2:10 still keeps half.
    expect(timeCredit(130, 65, 3)).toBeCloseTo(0.5);
    // One norm is the old rule: a second late is nothing.
    expect(timeCredit(66, 65, 1)).toBe(0);
  });

  it("scores 1:06 almost like 1:05 and 3:15 like a card without time points", () => {
    // Groups of a 112 card: time 3, address 3, services 3, completeness 1, literacy 1 → 11.
    expect(computeScore(late(65), weights)).toBe(100);
    expect(computeScore(late(66), weights)).toBe(100); // 1 s late costs 0.4 of 100
    expect(computeScore(late(98), weights)).toBe(86);
    expect(computeScore(late(130), weights)).toBe(73);
    expect(computeScore(late(195), weights)).toBe(73);
    // The longer, the lower — never higher.
    const scores = [66, 80, 98, 110, 130, 195].map((s) => computeScore(late(s), weights)!);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("keeps the old «уложился или нет» at a zero point of one norm and moves with the weights", () => {
    expect(computeScore(late(66), { ...weights, timeZeroAt: 1 })).toBe(73);
    expect(computeScore(late(130), { ...weights, timeZeroAt: 3 })).toBe(86);
    // The time weight still decides how much the time is worth.
    expect(computeScore(late(195), { ...weights, timeliness: 5 })).toBe(62);
  });

  it("uses the teacher's verdict when it differs, and keeps the partial points when it is the same", () => {
    const c = late(98);
    expect(computeScore(c, weights, { "op112.typing_time": true })).toBe(100);
    expect(computeScore(c, weights, { "op112.typing_time": null })).toBe(100);
    // The review form sends every verdict; «ошибка» as in the draft is not a change.
    expect(computeScore(c, weights, { "op112.typing_time": false })).toBe(86);
    // A card within the norm the teacher marks as a mistake gets nothing for time.
    expect(computeScore(late(60), weights, { "op112.typing_time": false })).toBe(73);
  });

  it("still caps a card with a critical error at 40", () => {
    const c = [...late(66), check("address", false, { critical: true })];
    expect(computeScore(c, weights)).toBeLessThanOrEqual(CRITICAL_CAP);
  });

  it("reads the zero point from the weights within bounds", () => {
    expect(timeZeroAt({})).toBe(TIME_ZERO_AT);
    expect(timeZeroAt({ timeZeroAt: 2.5 })).toBe(2.5);
    expect(timeZeroAt({ timeZeroAt: 0.2 })).toBe(1);
    expect(timeZeroAt({ timeZeroAt: 40 })).toBe(4);
  });

  it("explains the points of a late check in the review", () => {
    const [c] = late(98);
    expect(timePoints(c, weights)).toBe(49);
    expect(timePointsLine(c, weights)).toBe("Балл за время — 49 %: после норматива 1:05 он снижается равномерно, к 2:10 — ноль");
    expect(timePointsLine(late(195)[0], weights)).toBe("Балл за время — 0 %: после норматива 1:05 он снижается равномерно, к 2:10 — ноль");
    expect(timePointsLine(c, { timeZeroAt: 1 })).toBe("Балл за время — 0 %: после норматива 1:05 баллов за время нет");
    // Nothing to explain: within the norm, a check without time, a verdict the teacher changed.
    expect(timePointsLine(late(60)[0], weights)).toBeNull();
    expect(timePointsLine(check("timeliness", false), weights)).toBeNull();
    expect(timePointsLine(c, weights, { "op112.typing_time": true })).toBeNull();
    expect(timePointsLine(c, weights, { "op112.typing_time": false })).not.toBeNull();
  });
});
