/** Weight constants shared by the server and the browser (no database imports here). */
import { z } from "zod";
import { WEIGHT_GROUPS, type WeightGroup, type Weights } from "./score";

/** Starting weights: time, address and services matter most; text and completeness least (customer's Q&A). */
export const DEFAULT_WEIGHTS: Weights = {
  timeliness: 3,
  statusOrder: 2,
  comments: 2,
  address: 3,
  services: 3,
  completeness: 1,
  literacy: 1,
};

export const WEIGHT_MAX = 5;

export const GROUP_KEYS = Object.keys(WEIGHT_GROUPS) as WeightGroup[];

export const weightsSchema = z.object(
  Object.fromEntries(GROUP_KEYS.map((k) => [k, z.number().min(0).max(WEIGHT_MAX)])) as Record<WeightGroup, z.ZodNumber>,
);

/** Unknown or missing keys fall back to the defaults, so a partial profile never breaks scoring. */
export function normalizeWeights(raw: unknown): Weights {
  const out = { ...DEFAULT_WEIGHTS };
  if (raw && typeof raw === "object") {
    for (const k of GROUP_KEYS) {
      const v = (raw as Record<string, unknown>)[k];
      if (typeof v === "number" && Number.isFinite(v) && v >= 0) out[k] = Math.min(v, WEIGHT_MAX);
    }
  }
  return out;
}
