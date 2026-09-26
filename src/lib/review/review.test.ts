import { describe, expect, it } from "vitest";
import type { CriterionResult } from "@/lib/scoring/score";
import { DEFAULT_WEIGHTS } from "@/lib/scoring/weight-config";
import { planReview, type ReviewState } from "./review";

const criteria: CriterionResult[] = [
  { code: "t", group: "timeliness", title: "Вовремя", ok: false, source: "rule" },
  { code: "a", group: "address", title: "Адрес", ok: true, source: "rule" },
  { code: "l", group: "literacy", title: "Понятно", ok: false, source: "ai" },
];
const pending: ReviewState = { reviewStatus: "PENDING", override: null, score: 38, teacherComment: null };

describe("planReview", () => {
  it("confirms the draft as is and clears old corrections", () => {
    const plan = planReview(criteria, { ...pending, override: { l: true } }, { action: "confirm" }, DEFAULT_WEIGHTS);
    expect(plan.ok && plan.next).toEqual({ reviewStatus: "CONFIRMED", override: null, score: 43, teacherComment: null });
  });

  it("stores only the checks the teacher really changed and rescores", () => {
    const plan = planReview(criteria, pending, { action: "override", override: { t: false, l: true }, comment: "Сокращения допустимы" }, DEFAULT_WEIGHTS);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.next.override).toEqual({ l: true });
    expect(plan.changed).toEqual(["l"]);
    expect(plan.next.reviewStatus).toBe("OVERRIDDEN");
    expect(plan.next.score).toBe(57); // address 3 + literacy 1 of 3 + 3 + 1
  });

  it("asks for a comment and for at least one change", () => {
    expect(planReview(criteria, pending, { action: "override", override: { l: true } }, DEFAULT_WEIGHTS)).toMatchObject({ ok: false });
    expect(planReview(criteria, pending, { action: "override", override: { l: false }, comment: "x" }, DEFAULT_WEIGHTS)).toMatchObject({
      ok: false,
      error: expect.stringContaining("Верно"),
    });
    expect(planReview(criteria, pending, { action: "override", override: { zzz: true }, comment: "x" }, DEFAULT_WEIGHTS)).toMatchObject({ ok: false });
  });

  it("can mark a check as not applicable", () => {
    const plan = planReview(criteria, pending, { action: "override", override: { t: null }, comment: "Задержка из-за сбоя стенда" }, DEFAULT_WEIGHTS);
    // timeliness drops out of the denominator: address 3 of 3, literacy 0 of 1 → 75 %
    expect(plan.ok && plan.next.score).toBe(75);
  });

  it("reopens only a reviewed attempt", () => {
    expect(planReview(criteria, pending, { action: "reopen" }, DEFAULT_WEIGHTS)).toMatchObject({ ok: false });
    const plan = planReview(criteria, { ...pending, reviewStatus: "CONFIRMED" }, { action: "reopen" }, DEFAULT_WEIGHTS);
    expect(plan.ok && plan.next.reviewStatus).toBe("PENDING");
  });
});
