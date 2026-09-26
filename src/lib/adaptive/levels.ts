/**
 * Reads what the rating needs from the database. The rating is not stored: it is replayed from the
 * attempts on every read (see rating.ts), so it can never disagree with the attempts themselves.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { computeRating, ratingsByRole, type Rating, type RatingAttempt, type RatingRole } from "./rating";

type Client = PrismaClient | Prisma.TransactionClient;

const ratingSelect = {
  id: true,
  studentId: true,
  kind: true,
  score: true,
  reviewStatus: true,
  createdAt: true,
  scenario: { select: { difficulty: true } },
} satisfies Prisma.AttemptSelect;

type Row = Prisma.AttemptGetPayload<{ select: typeof ratingSelect }>;

function toRatingAttempt(r: Row): RatingAttempt {
  return { id: r.id, kind: r.kind, score: r.score, reviewStatus: r.reviewStatus, createdAt: r.createdAt, difficulty: r.scenario?.difficulty ?? null };
}

/** Attempts of these students for the rating, grouped by student. */
export async function loadRatingAttempts(studentIds: string[], client: Client = db, role?: RatingRole): Promise<Map<string, RatingAttempt[]>> {
  const out = new Map<string, RatingAttempt[]>(studentIds.map((id) => [id, []]));
  if (!studentIds.length) return out;
  const rows = await client.attempt.findMany({
    where: { studentId: { in: [...new Set(studentIds)] }, ...(role ? { kind: role } : {}) },
    select: ratingSelect,
  });
  for (const r of rows) out.get(r.studentId)?.push(toRatingAttempt(r));
  return out;
}

/** The level of one student in one role, e.g. to choose the next task. */
export async function studentRating(studentId: string, role: RatingRole, client: Client = db): Promise<Rating> {
  const attempts = (await loadRatingAttempts([studentId], client, role)).get(studentId) ?? [];
  return computeRating(role, attempts);
}

/** Levels of several students in both roles. */
export async function studentRatings(studentIds: string[], client: Client = db): Promise<Map<string, Record<RatingRole, Rating>>> {
  const attempts = await loadRatingAttempts(studentIds, client);
  return new Map([...attempts.entries()].map(([id, list]) => [id, ratingsByRole(list)]));
}
