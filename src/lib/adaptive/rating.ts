/**
 * Student level «как в шахматах»: an Elo rating, separate for the 112 place and for the ДДС place.
 *
 * A scenario of difficulty d (1–10) plays the opponent with the rating 900 + 100·d. The expected
 * score is tuned so that on a task of the student's own level the student is expected to get 70 out
 * of 100 — confident work with something left to learn. After every attempt the rating moves by
 * K × (score / 100 − expected): above the expectation — up, below — down. K is large for a newcomer
 * and shrinks as attempts accumulate; a draft the teacher has not confirmed yet moves it half as much.
 *
 * Nothing is stored: the rating is replayed from the attempts in time order, so a recount always
 * gives the same number and follows every teacher decision, reopened review or change of weights.
 */

export type RatingRole = "OP112" | "DDS";

export const ROLE_LABEL: Record<RatingRole, string> = { OP112: "Оператор 112", DDS: "Диспетчер ДДС" };

export const RATING = {
  /** Task rating = base + step × difficulty: difficulty 3 → 1200, as a newcomer in chess. */
  base: 900,
  step: 100,
  /** A newcomer starts at the level of difficulty 3, the default difficulty of a new scenario. */
  start: 1200,
  /** Elo scale: 400 points of difference mean ten times the odds. */
  scale: 400,
  /** Expected share of the score on a task of the student's own level. */
  target: 0.7,
  /** K = kMax / (1 + n / kHalf), not below kMin; n = attempts counted so far (a draft counts as half). */
  kMax: 160,
  kHalf: 10,
  kMin: 40,
  /** Weight of an attempt the teacher has not confirmed yet. */
  draftWeight: 0.5,
  /** The rating stays within these bounds: one weak streak must not bury the level forever. */
  min: 600,
  max: 2400,
  /** Difficulty of an attempt without a scenario (the schema default). */
  defaultDifficulty: 3,
} as const;

/** Odds factor that puts the expected score at `target` for equal ratings: (1 − 0.7) / 0.7 = 3/7. */
const TARGET_ODDS = (1 - RATING.target) / RATING.target;

export type RatingAttempt = {
  id: string;
  kind: RatingRole;
  score: number | null;
  reviewStatus: "PENDING" | "CONFIRMED" | "OVERRIDDEN";
  createdAt: Date;
  difficulty: number | null;
};

export type RatingStep = {
  attemptId: string;
  at: Date;
  difficulty: number;
  score: number;
  /** Expected score before the attempt, 0–100. */
  expected: number;
  confirmed: boolean;
  delta: number;
  rating: number;
};

export type Rating = {
  role: RatingRole;
  rating: number;
  /** Recommended task difficulty, 1–10. */
  difficulty: number;
  /** Attempts that moved the rating (with a score). */
  attempts: number;
  confirmed: number;
  steps: RatingStep[];
};

export const clampDifficulty = (d: number) => Math.min(10, Math.max(1, Math.round(d)));

export function taskRating(difficulty: number | null | undefined): number {
  return RATING.base + RATING.step * clampDifficulty(difficulty ?? RATING.defaultDifficulty);
}

/** Expected result 0–1 of a student with `rating` on a task of `difficulty`. */
export function expectedScore(rating: number, difficulty: number | null | undefined): number {
  return 1 / (1 + TARGET_ODDS * 10 ** ((taskRating(difficulty) - rating) / RATING.scale));
}

/** K of the next attempt after `counted` attempts (drafts count by their weight). */
export function kFactor(counted: number): number {
  return Math.max(RATING.kMin, RATING.kMax / (1 + counted / RATING.kHalf));
}

/** The difficulty whose task rating is closest to the student's rating: there the expected score is 70. */
export function recommendedDifficulty(rating: number): number {
  return clampDifficulty((rating - RATING.base) / RATING.step);
}

const byTime = (a: RatingAttempt, b: RatingAttempt) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Replays the attempts of one role in time order. Attempts without a score (nothing to check) do
 * not move the rating. `until` limits the history, e.g. to the start of a lesson.
 */
export function computeRating(role: RatingRole, attempts: RatingAttempt[], opts: { until?: Date } = {}): Rating {
  const list = attempts
    .filter((a) => a.kind === role && a.score != null && Number.isFinite(a.score))
    .filter((a) => !opts.until || a.createdAt < opts.until)
    .sort(byTime);
  let rating: number = RATING.start;
  let counted = 0;
  const steps: RatingStep[] = [];
  for (const a of list) {
    const confirmed = a.reviewStatus !== "PENDING";
    const weight = confirmed ? 1 : RATING.draftWeight;
    const difficulty = clampDifficulty(a.difficulty ?? RATING.defaultDifficulty);
    const score = Math.min(100, Math.max(0, a.score!));
    const expected = expectedScore(rating, difficulty);
    const next = Math.min(RATING.max, Math.max(RATING.min, rating + weight * kFactor(counted) * (score / 100 - expected)));
    steps.push({
      attemptId: a.id,
      at: a.createdAt,
      difficulty,
      score,
      expected: Math.round(expected * 100),
      confirmed,
      delta: Math.round(next - rating),
      rating: Math.round(next),
    });
    rating = next;
    counted += weight;
  }
  return {
    role,
    rating: Math.round(rating),
    difficulty: recommendedDifficulty(rating),
    attempts: steps.length,
    confirmed: steps.filter((s) => s.confirmed).length,
    steps,
  };
}

export function ratingsByRole(attempts: RatingAttempt[], opts: { until?: Date } = {}): Record<RatingRole, Rating> {
  return { OP112: computeRating("OP112", attempts, opts), DDS: computeRating("DDS", attempts, opts) };
}

/** Short words for the level, for tiles and tables. */
export function levelWord(rating: Rating): string {
  if (!rating.attempts) return "новичок";
  if (rating.difficulty <= 2) return "начальный";
  if (rating.difficulty <= 4) return "базовый";
  if (rating.difficulty <= 6) return "уверенный";
  if (rating.difficulty <= 8) return "сильный";
  return "эксперт";
}
