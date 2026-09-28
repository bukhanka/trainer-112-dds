import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, normalizeWeights, sameWeights, weightsSchema } from "./weight-config";

describe("weights with the time zero point", () => {
  it("defaults to twice the norm and keeps a saved value within bounds", () => {
    expect(DEFAULT_WEIGHTS.timeZeroAt).toBe(2);
    // An old profile without the key — the default; a broken value — clamped.
    expect(normalizeWeights({ timeliness: 3 }).timeZeroAt).toBe(2);
    expect(normalizeWeights({ timeZeroAt: 2.5 }).timeZeroAt).toBe(2.5);
    expect(normalizeWeights({ timeZeroAt: 9 }).timeZeroAt).toBe(4);
    expect(normalizeWeights({ timeZeroAt: "3" }).timeZeroAt).toBe(2);
  });

  it("accepts the zero point from the weights panel and rejects nonsense", () => {
    const groups = { timeliness: 3, statusOrder: 2, comments: 2, address: 3, services: 3, completeness: 1, literacy: 1 };
    expect(weightsSchema.safeParse({ ...groups, timeZeroAt: 1.5 }).success).toBe(true);
    expect(weightsSchema.safeParse(groups).success).toBe(true);
    expect(weightsSchema.safeParse({ ...groups, timeZeroAt: 0.5 }).success).toBe(false);
    expect(weightsSchema.safeParse({ ...groups, timeZeroAt: 5 }).success).toBe(false);
  });

  it("counts a new zero point as a change to save", () => {
    expect(sameWeights(DEFAULT_WEIGHTS, { ...DEFAULT_WEIGHTS })).toBe(true);
    expect(sameWeights(DEFAULT_WEIGHTS, { ...DEFAULT_WEIGHTS, timeZeroAt: undefined })).toBe(true);
    expect(sameWeights(DEFAULT_WEIGHTS, { ...DEFAULT_WEIGHTS, timeZeroAt: 3 })).toBe(false);
    expect(sameWeights(DEFAULT_WEIGHTS, { ...DEFAULT_WEIGHTS, address: 4 })).toBe(false);
  });
});
