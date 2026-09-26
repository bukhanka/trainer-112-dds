import { db } from "@/lib/db";
import type { Weights } from "./score";
import { normalizeWeights } from "./weight-config";

export { DEFAULT_WEIGHTS, GROUP_KEYS, WEIGHT_MAX, normalizeWeights, weightsSchema } from "./weight-config";

export async function getActiveWeights(): Promise<{ weights: Weights; profileId: string | null; name: string | null; updatedAt: Date | null }> {
  const profile = await db.weightProfile.findFirst({ where: { isActive: true }, orderBy: { updatedAt: "desc" } });
  return {
    weights: normalizeWeights(profile?.weights),
    profileId: profile?.id ?? null,
    name: profile?.name ?? null,
    updatedAt: profile?.updatedAt ?? null,
  };
}
