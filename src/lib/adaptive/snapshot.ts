/**
 * «Прогноз ↔ факт». When a lesson starts, the forecast of every student of the lesson is saved as it
 * stood at that moment (ForecastSnapshot) and is never recomputed. Once the teacher confirms the
 * lesson's attempts, the fact — the student's average confirmed score of the lesson — is set against
 * it, and the report shows the mean absolute error in points.
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { accuracy, forecastScores, forecastTime, type Accuracy } from "./forecast";
import { loadHistory, normFor, type HistoryAttempt } from "./history";
import { teacherLessons } from "./levels";
import { computeRating, type RatingRole } from "./rating";

type Client = PrismaClient | Prisma.TransactionClient;

/**
 * The forecast of every seat of a lesson from the history before `at`. The classmates are the other
 * students of the lesson: their past lessons give the group's level and the misses behind the interval. Pure.
 */
export function snapshotRows(input: {
  lessonId: string;
  settings: unknown;
  seats: { studentId: string; role: RatingRole }[];
  history: Map<string, HistoryAttempt[]>;
  at: Date;
}): Prisma.ForecastSnapshotCreateManyInput[] {
  const students = [...new Set(input.seats.map((s) => s.studentId))];
  const scores = forecastScores(new Map(students.map((id) => [id, input.history.get(id) ?? []])), { cutoff: input.at, peersOf: () => students });
  return input.seats.map((seat) => {
    const list = input.history.get(seat.studentId) ?? [];
    const normSec = normFor(input.settings, seat.role);
    const score = scores.get(seat.studentId) ?? null;
    const time = forecastTime(list, seat.role, { cutoff: input.at, normSec });
    const level = computeRating(seat.role, list, { until: input.at });
    return {
      lessonId: input.lessonId,
      studentId: seat.studentId,
      role: seat.role,
      expected: score?.expected ?? null,
      low: score?.low ?? null,
      high: score?.high ?? null,
      baseline: score?.baseline ?? null,
      trend: score?.trend ?? null,
      lessons: score?.lessons ?? 0,
      pOnTime: time?.pOnTime ?? null,
      normSec,
      rating: level.rating,
      difficulty: level.difficulty,
      createdAt: input.at,
    };
  });
}

/**
 * Saves the snapshot of a lesson that has just started. Idempotent: a student who already has a
 * snapshot for this lesson keeps it. Reads only the attempts of the lesson teacher's lessons.
 */
export async function saveLessonForecasts(lessonId: string, opts: { at?: Date; client?: Client } = {}): Promise<number> {
  const client = opts.client ?? db;
  const lesson = await client.lesson.findUnique({
    where: { id: lessonId },
    select: { id: true, teacherId: true, status: true, settings: true, startedAt: true, seats: { select: { studentId: true, role: true } } },
  });
  // A draft lesson gets its snapshot when it starts, not before.
  if (!lesson || lesson.status === "DRAFT" || !lesson.seats.length) return 0;
  const at = opts.at ?? lesson.startedAt ?? new Date();
  const history = await loadHistory(lesson.seats.map((s) => s.studentId), { client, scope: teacherLessons(lesson.teacherId) });
  const data = snapshotRows({ lessonId: lesson.id, settings: lesson.settings, seats: lesson.seats, history, at });
  const res = await client.forecastSnapshot.createMany({ data, skipDuplicates: true });
  return res.count;
}

// ─── forecast against the fact ──────────────────────────────────────────────

export type SnapshotRow = {
  studentId: string;
  role: RatingRole;
  expected: number | null;
  low: number | null;
  high: number | null;
  baseline: number | null;
  trend: number | null;
  lessons: number;
  pOnTime: number | null;
  normSec: number | null;
  rating: number;
  difficulty: number;
};

export type FactAttempt = { studentId: string; reviewStatus: "PENDING" | "CONFIRMED" | "OVERRIDDEN"; score: number | null; timeSec?: number | null };

export type LessonForecastRow = {
  studentId: string;
  name: string;
  seat: string;
  role: RatingRole;
  snapshot: SnapshotRow | null;
  /** Average confirmed score of the lesson. */
  fact: number | null;
  confirmed: number;
  pending: number;
  /** Confirmed attempts of the lesson that met the norm, against the forecast chance. */
  onTime: { met: number; total: number } | null;
  /** fact − forecast. */
  error: number | null;
  inside: boolean | null;
};

export type LessonForecast = { rows: LessonForecastRow[]; accuracy: Accuracy; snapshots: number };

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Pure: the lesson's seats, the snapshots saved at its start and its attempts. */
export function buildLessonForecast(input: {
  seats: { studentId: string; name: string; seat: string; role: RatingRole }[];
  snapshots: SnapshotRow[];
  attempts: FactAttempt[];
}): LessonForecast {
  const rows = input.seats.map((seat) => {
    const snapshot = input.snapshots.find((s) => s.studentId === seat.studentId) ?? null;
    const mine = input.attempts.filter((a) => a.studentId === seat.studentId);
    const confirmed = mine.filter((a) => a.reviewStatus !== "PENDING" && a.score != null);
    const fact = confirmed.length ? round1(confirmed.reduce((a, x) => a + x.score!, 0) / confirmed.length) : null;
    const timed = confirmed.filter((a) => a.timeSec != null);
    const norm = snapshot?.normSec ?? null;
    const error = fact != null && snapshot?.expected != null ? round1(fact - snapshot.expected) : null;
    return {
      ...seat,
      snapshot,
      fact,
      confirmed: confirmed.length,
      pending: mine.filter((a) => a.reviewStatus === "PENDING").length,
      onTime: norm && timed.length ? { met: timed.filter((a) => a.timeSec! <= norm).length, total: timed.length } : null,
      error,
      inside: fact != null && snapshot?.low != null && snapshot.high != null ? fact >= snapshot.low && fact <= snapshot.high : null,
    };
  });
  return {
    rows,
    accuracy: accuracy(rows.map((r) => ({ expected: r.snapshot?.expected ?? null, low: r.snapshot?.low ?? null, high: r.snapshot?.high ?? null, baseline: r.snapshot?.baseline ?? null, fact: r.fact }))),
    snapshots: input.snapshots.length,
  };
}
