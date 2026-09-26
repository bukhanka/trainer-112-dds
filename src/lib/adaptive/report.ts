/**
 * Levels of a lesson's students for the teacher's report: the rating before the lesson (attempts up
 * to its start), after it (plus the lesson's own attempts) and the difficulty of the tasks they had.
 * Pure function over plain rows.
 */
import { computeRating, type RatingAttempt, type RatingRole } from "./rating";

export type LevelSeat = { studentId: string; name: string; seat: string; role: RatingRole };

export type LevelRow = LevelSeat & {
  before: number;
  after: number;
  delta: number;
  /** Recommended difficulty after the lesson. */
  difficulty: number;
  /** Attempts of the lesson in this role that moved the rating. */
  lessonAttempts: number;
  /** Difficulty of the lesson's tasks at this place. */
  tasks: { min: number; max: number; mean: number } | null;
  /** No attempts in this role before the lesson. */
  newcomer: boolean;
};

export function lessonLevels(input: { lessonId: string; start: Date; seats: LevelSeat[]; attempts: Map<string, RatingAttempt[]> }): LevelRow[] {
  return input.seats.map((seat) => {
    const all = input.attempts.get(seat.studentId) ?? [];
    const before = computeRating(seat.role, all, { until: input.start });
    const after = computeRating(
      seat.role,
      all.filter((a) => a.createdAt < input.start || a.lessonId === input.lessonId),
    );
    const earlier = new Set(before.steps.map((s) => s.attemptId));
    const own = after.steps.filter((s) => !earlier.has(s.attemptId));
    const diffs = own.map((s) => s.difficulty);
    return {
      ...seat,
      before: before.rating,
      after: after.rating,
      delta: after.rating - before.rating,
      difficulty: after.difficulty,
      lessonAttempts: own.length,
      tasks: diffs.length ? { min: Math.min(...diffs), max: Math.max(...diffs), mean: Math.round((diffs.reduce((a, b) => a + b, 0) / diffs.length) * 10) / 10 } : null,
      newcomer: before.attempts === 0,
    };
  });
}
