import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CriterionResult } from "@/lib/scoring/score";

const transaction = vi.hoisted(() => vi.fn());
const lockScores = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("@/lib/db", () => ({ db: { $transaction: transaction } }));
vi.mock("@/lib/scoring/weights", () => ({
  lockScores,
  weightsForAttempt: async () => ({ timeliness: 1, statusOrder: 1, comments: 1, address: 1, services: 1, completeness: 1, literacy: 1 }),
  getActiveWeights: async () => ({
    weights: { timeliness: 1, statusOrder: 1, comments: 1, address: 1, services: 1, completeness: 1, literacy: 1 },
  }),
}));

import { aiUnavailable, AI_CODES } from "./evaluate";
import { replacePendingCriteria } from "./review";

const rule: CriterionResult = { code: "op112.field.description", group: "completeness", title: "Описание", ok: true, source: "rule" };
const ai: CriterionResult = { code: "op112.ai.said", group: "completeness", title: "ИИ", ok: false, source: "ai" };

function database(reviewStatus: "PENDING" | "CONFIRMED" | "OVERRIDDEN", beforeUpdate?: () => void) {
  const state: { reviewStatus: string; criteria: CriterionResult[]; override: null; score: number | null } = {
    reviewStatus,
    criteria: [rule],
    override: null,
    score: 100,
  };
  const tx = {
    attempt: {
      findUnique: vi.fn(async () => ({ ...state })),
      updateMany: vi.fn(async ({ where, data }: { where: { reviewStatus: string }; data: { criteria: CriterionResult[]; score: number | null } }) => {
        beforeUpdate?.();
        if (state.reviewStatus !== where.reviewStatus) return { count: 0 };
        state.criteria = data.criteria;
        state.score = data.score;
        return { count: 1 };
      }),
    },
  };
  transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<void>) => callback(tx));
  return { state, tx };
}

beforeEach(() => {
  transaction.mockReset();
  lockScores.mockClear();
});

describe("background 112 review and teacher decision", () => {
  it("adds AI checks to an open attempt under the teacher's score lock", async () => {
    const { state, tx } = database("PENDING");
    await replacePendingCriteria("a1", new Set<string>(AI_CODES), [ai]);
    expect(lockScores).toHaveBeenCalledOnce();
    expect(tx.attempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "a1", reviewStatus: "PENDING" } }));
    expect(state.criteria).toEqual([rule, ai]);
    expect(state.score).toBeLessThan(100);
  });

  it.each(["CONFIRMED", "OVERRIDDEN"] as const)("a late model result cannot alter a %s attempt", async (status) => {
    const { state, tx } = database(status);
    await replacePendingCriteria("a1", new Set<string>(AI_CODES), [ai]);
    expect(tx.attempt.updateMany).not.toHaveBeenCalled();
    expect(state).toMatchObject({ reviewStatus: status, criteria: [rule], score: 100 });
  });

  it("the pending condition protects the write even if the decision changes after the read", async () => {
    const { state, tx } = database("PENDING", () => { state.reviewStatus = "CONFIRMED"; });
    await replacePendingCriteria("a1", new Set<string>(AI_CODES), [ai]);
    expect(tx.attempt.updateMany).toHaveBeenCalledOnce();
    expect(state).toMatchObject({ reviewStatus: "CONFIRMED", criteria: [rule], score: 100 });
  });

  it("the model-error fallback obeys the same guard", async () => {
    const { state, tx } = database("OVERRIDDEN");
    await replacePendingCriteria("a1", new Set<string>(AI_CODES), aiUnavailable("ИИ-проверка не удалась"));
    expect(tx.attempt.updateMany).not.toHaveBeenCalled();
    expect(state.criteria).toEqual([rule]);
  });
});
