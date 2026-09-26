/**
 * Reads what the rating needs from the database. The rating is not stored: it is replayed from the
 * attempts on every read (see rating.ts), so it can never disagree with the attempts themselves.
 *
 * Choosing the next task uses all the student's attempts. What a teacher sees (board, plan, report,
 * snapshot) is replayed from the attempts of that teacher's lessons only — `scope`, the same rule as
 * everywhere in the cabinet.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { computeRating, ratingsByRole, type Rating, type RatingAttempt, type RatingRole } from "./rating";

type Client = PrismaClient | Prisma.TransactionClient;

type LoadOptions = { client?: Client; role?: RatingRole; scope?: Prisma.AttemptWhereInput };

const ratingSelect = {
  id: true,
  studentId: true,
  lessonId: true,
  kind: true,
  score: true,
  reviewStatus: true,
  createdAt: true,
  reviewedAt: true,
  scenario: { select: { difficulty: true } },
} satisfies Prisma.AttemptSelect;

type Row = Prisma.AttemptGetPayload<{ select: typeof ratingSelect }>;

function toRatingAttempt(r: Row): RatingAttempt {
  return {
    id: r.id,
    lessonId: r.lessonId,
    kind: r.kind,
    score: r.score,
    reviewStatus: r.reviewStatus,
    createdAt: r.createdAt,
    reviewedAt: r.reviewedAt,
    difficulty: r.scenario?.difficulty ?? null,
  };
}

/** Attempts of these students for the rating, grouped by student. */
export async function loadRatingAttempts(studentIds: string[], opts: LoadOptions = {}): Promise<Map<string, RatingAttempt[]>> {
  const ids = [...new Set(studentIds)];
  const out = new Map<string, RatingAttempt[]>(ids.map((id) => [id, []]));
  if (!ids.length) return out;
  const rows = await (opts.client ?? db).attempt.findMany({
    where: { studentId: { in: ids }, ...(opts.role ? { kind: opts.role } : {}), ...opts.scope },
    select: ratingSelect,
  });
  for (const r of rows) out.get(r.studentId)?.push(toRatingAttempt(r));
  return out;
}

/** The level of one student in one role, e.g. to choose the next task. */
export async function studentRating(studentId: string, role: RatingRole, client: Client = db): Promise<Rating> {
  const attempts = (await loadRatingAttempts([studentId], { client, role })).get(studentId) ?? [];
  return computeRating(role, attempts);
}

/** Levels of several students in both roles. */
export async function studentRatings(studentIds: string[], opts: Omit<LoadOptions, "role"> = {}): Promise<Map<string, Record<RatingRole, Rating>>> {
  const attempts = await loadRatingAttempts(studentIds, opts);
  return new Map([...attempts.entries()].map(([id, list]) => [id, ratingsByRole(list)]));
}

/** Attempts a teacher's view of a lesson may use: those of lessons of the same teacher. */
export function teacherLessons(teacherId: string): Prisma.AttemptWhereInput {
  return { lesson: { teacherId } };
}
