import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { isPractice } from "@/lib/lessons/form";
import type { Weights } from "./score";
import { normalizeWeights } from "./weight-config";

export { DEFAULT_WEIGHTS, GROUP_KEYS, WEIGHT_MAX, normalizeWeights, weightsSchema } from "./weight-config";

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * Saving weights rescores every attempt; a teacher's decision rescores one. Both take this lock inside
 * their transaction, so a decision never lands between «read all attempts» and «write new scores»
 * and is never scored with weights that are being replaced.
 */
const SCORES_LOCK = 71_120_926;

export async function lockScores(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${SCORES_LOCK})`;
}

export async function getActiveWeights(client: Client = db): Promise<{ weights: Weights; profileId: string | null; name: string | null; updatedAt: Date | null }> {
  const profile = await client.weightProfile.findFirst({ where: { isActive: true }, orderBy: { updatedAt: "desc" } });
  return {
    weights: normalizeWeights(profile?.weights),
    profileId: profile?.id ?? null,
    name: profile?.name ?? null,
    updatedAt: profile?.updatedAt ?? null,
  };
}

/** A running class lesson blocks saving weights; a student's self-practice does not. */
export async function runningLesson(client: Client = db): Promise<{ title: string } | null> {
  const running = await client.lesson.findMany({ where: { status: "RUNNING" }, select: { title: true, settings: true } });
  const lesson = running.find((l) => !isPractice(l.settings));
  return lesson ? { title: lesson.title } : null;
}
