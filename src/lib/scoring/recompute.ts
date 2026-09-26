import { Prisma, type PrismaClient } from "@prisma/client";
import { readCriteria, readOverrides } from "@/lib/review/draft";
import { computeScore, type Weights } from "./score";

type Tx = Prisma.TransactionClient | PrismaClient;

const CHUNK = 500;

/**
 * Recomputes Attempt.score of every attempt with new weights. Raw criteria and teacher corrections
 * are stored on the attempt, so the new score is exact, not an estimate. Only changed rows are written.
 */
export async function recomputeAllScores(tx: Tx, weights: Weights): Promise<{ total: number; changed: number }> {
  const rows = await tx.attempt.findMany({ select: { id: true, criteria: true, override: true, score: true } });
  const updates: { id: string; score: number | null }[] = [];
  for (const a of rows) {
    const score = computeScore(readCriteria(a.criteria), weights, readOverrides(a.override));
    if (score !== a.score) updates.push({ id: a.id, score });
  }
  for (let i = 0; i < updates.length; i += CHUNK) {
    const part = updates.slice(i, i + CHUNK);
    const values = Prisma.join(part.map((u) => Prisma.sql`(${u.id}, ${u.score}::float8)`));
    await tx.$executeRaw`UPDATE "Attempt" AS a SET "score" = v.score FROM (VALUES ${values}) AS v(id, score) WHERE a."id" = v.id`;
  }
  return { total: rows.length, changed: updates.length };
}
