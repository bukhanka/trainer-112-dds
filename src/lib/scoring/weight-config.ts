/** Weight constants shared by the server and the browser (no database imports here). */
import { z } from "zod";
import { TIME_ZERO_AT, TIME_ZERO_MAX, TIME_ZERO_MIN, WEIGHT_GROUPS, type WeightGroup, type Weights } from "./score";

/**
 * Starting weights: time, address and services matter most; text and completeness least (customer's Q&A).
 * Past the time norm the points of a time check fall to zero at twice the norm (TIME_ZERO_AT).
 */
export const DEFAULT_WEIGHTS: Weights = {
  timeliness: 3,
  statusOrder: 2,
  comments: 2,
  address: 3,
  services: 3,
  completeness: 1,
  literacy: 1,
  timeZeroAt: TIME_ZERO_AT,
};

export const WEIGHT_MAX = 5;

export const GROUP_KEYS = Object.keys(WEIGHT_GROUPS) as WeightGroup[];

export const weightsSchema = z
  .object(Object.fromEntries(GROUP_KEYS.map((k) => [k, z.number().min(0).max(WEIGHT_MAX)])) as Record<WeightGroup, z.ZodNumber>)
  .extend({ timeZeroAt: z.number().min(TIME_ZERO_MIN).max(TIME_ZERO_MAX).optional() });

/** Unknown or missing keys fall back to the defaults, so a partial profile never breaks scoring. */
export function normalizeWeights(raw: unknown): Weights {
  const out = { ...DEFAULT_WEIGHTS };
  if (raw && typeof raw === "object") {
    for (const k of GROUP_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = Math.min(v, WEIGHT_MAX);
    }
    const zero = (raw as Record<string, unknown>).timeZeroAt;
    if (typeof zero === "number" && Number.isFinite(zero)) out.timeZeroAt = Math.min(TIME_ZERO_MAX, Math.max(TIME_ZERO_MIN, zero));
  }
  return out;
}

/** Same weights and the same time zero point: nothing to save. */
export function sameWeights(a: Weights, b: Weights): boolean {
  return GROUP_KEYS.every((k) => a[k] === b[k]) && (a.timeZeroAt ?? TIME_ZERO_AT) === (b.timeZeroAt ?? TIME_ZERO_AT);
}
