import { describe, expect, it } from "vitest";
import { computeRating, expectedScore, kFactor, RATING, ratingsByRole, recommendedDifficulty, taskRating, type RatingAttempt } from "./rating";

let seq = 0;
function attempt(score: number | null, difficulty: number | null, opts: Partial<RatingAttempt> = {}): RatingAttempt {
  seq++;
  return {
    id: `a${String(seq).padStart(3, "0")}`,
    kind: "DDS",
    score,
    difficulty,
    reviewStatus: "CONFIRMED",
    createdAt: new Date(Date.UTC(2026, 8, 1, 7, seq)),
    ...opts,
  };
}

describe("task rating and expected score", () => {
  it("maps difficulty 1–10 onto the rating scale, difficulty 3 = a newcomer", () => {
    expect(taskRating(1)).toBe(1000);
    expect(taskRating(3)).toBe(RATING.start);
    expect(taskRating(10)).toBe(1900);
    expect(taskRating(0)).toBe(1000); // clamped
    expect(taskRating(15)).toBe(1900);
    expect(taskRating(null)).toBe(taskRating(RATING.defaultDifficulty));
  });

  it("expects 70 on a task of the student's own level, more on easier and less on harder ones", () => {
    expect(expectedScore(1200, 3)).toBeCloseTo(0.7, 6);
    expect(expectedScore(1200, 1)).toBeGreaterThan(0.8);
    expect(expectedScore(1200, 7)).toBeLessThan(0.35);
    // 400 points above the task: ten times better odds than at par.
    const odds = (p: number) => p / (1 - p);
    expect(odds(expectedScore(1600, 3)) / odds(expectedScore(1200, 3))).toBeCloseTo(10, 6);
  });

  it("recommends the difficulty whose task rating is nearest, within 1–10", () => {
    expect(recommendedDifficulty(RATING.start)).toBe(3);
    expect(recommendedDifficulty(1449)).toBe(5);
    expect(recommendedDifficulty(1540)).toBe(6);
    expect(recommendedDifficulty(200)).toBe(1);
    expect(recommendedDifficulty(5000)).toBe(10);
  });

  it("shrinks K as attempts accumulate, never below the floor", () => {
    expect(kFactor(0)).toBe(RATING.kMax);
    expect(kFactor(10)).toBe(RATING.kMax / 2);
    expect(kFactor(5)).toBeGreaterThan(kFactor(6));
    expect(kFactor(1000)).toBe(RATING.kMin);
  });
});

describe("Elo replay of the attempts", () => {
  it("a newcomer starts at difficulty 3", () => {
    const r = computeRating("DDS", []);
    expect(r).toMatchObject({ rating: RATING.start, difficulty: 3, attempts: 0 });
  });

  it("goes up above the expectation and down below it", () => {
    const strong = computeRating("DDS", [attempt(95, 3), attempt(92, 3), attempt(90, 4)]);
    const weak = computeRating("DDS", [attempt(35, 3), attempt(40, 3), attempt(30, 2)]);
    expect(strong.rating).toBeGreaterThan(RATING.start);
    expect(strong.difficulty).toBeGreaterThan(3);
    expect(weak.rating).toBeLessThan(RATING.start);
    expect(weak.difficulty).toBeLessThan(3);
    expect(strong.steps.every((s) => s.delta > 0)).toBe(true);
  });

  it("gives more for a good result on a hard task than on an easy one", () => {
    const hard = computeRating("DDS", [attempt(80, 7)]);
    const easy = computeRating("DDS", [attempt(80, 1)]);
    expect(hard.rating).toBeGreaterThan(easy.rating);
    expect(easy.rating).toBeLessThan(RATING.start); // 80 on the easiest task is below the expected ~87
  });

  it("moves half as much on a draft as on a confirmed attempt", () => {
    const confirmed = computeRating("DDS", [attempt(100, 3)]);
    const draft = computeRating("DDS", [attempt(100, 3, { reviewStatus: "PENDING" })]);
    expect(confirmed.rating - RATING.start).toBe(48); // 160 × (1 − 0.7)
    expect(draft.rating - RATING.start).toBe(24);
    expect(draft.confirmed).toBe(0);
  });

  it("keeps the roles apart and skips attempts without a score", () => {
    const list = [attempt(100, 3, { kind: "OP112" }), attempt(20, 3), attempt(null, 3)];
    const both = ratingsByRole(list);
    expect(both.OP112.rating).toBeGreaterThan(RATING.start);
    expect(both.DDS.rating).toBeLessThan(RATING.start);
    expect(both.DDS.attempts).toBe(1);
  });

  it("is a pure replay: any input order, same history and number", () => {
    const list = [attempt(90, 4), attempt(55, 5), attempt(70, 3, { reviewStatus: "PENDING" }), attempt(88, 4, { reviewStatus: "OVERRIDDEN" })];
    const a = computeRating("DDS", list);
    const b = computeRating("DDS", [...list].reverse());
    expect(b).toEqual(a);
    expect(computeRating("DDS", list)).toEqual(a);
    expect(a.steps.map((s) => s.attemptId)).toEqual(list.map((x) => x.id));
  });

  it("orders attempts with the same time by id, so ties do not depend on the database order", () => {
    const at = new Date("2026-09-10T07:00:00Z");
    const x = attempt(95, 3, { id: "b", createdAt: at });
    const y = attempt(30, 3, { id: "a", createdAt: at });
    expect(computeRating("DDS", [x, y]).steps.map((s) => s.attemptId)).toEqual(["a", "b"]);
    expect(computeRating("DDS", [y, x])).toEqual(computeRating("DDS", [x, y]));
  });

  it("can stop the history at a moment, e.g. the start of a lesson", () => {
    const early = attempt(95, 3, { createdAt: new Date("2026-09-10T07:00:00Z") });
    const late = attempt(20, 3, { createdAt: new Date("2026-09-12T07:00:00Z") });
    const before = computeRating("DDS", [early, late], { until: new Date("2026-09-11T00:00:00Z") });
    expect(before.attempts).toBe(1);
    expect(before.rating).toBe(computeRating("DDS", [early]).rating);
  });

  it("stays within its bounds on a long streak", () => {
    const zeros = Array.from({ length: 200 }, () => attempt(0, 1));
    const perfect = Array.from({ length: 200 }, () => attempt(100, 10));
    expect(computeRating("DDS", zeros).rating).toBeGreaterThanOrEqual(RATING.min);
    expect(computeRating("DDS", perfect).rating).toBeLessThanOrEqual(RATING.max);
    expect(computeRating("DDS", zeros).difficulty).toBe(1);
    expect(computeRating("DDS", perfect).difficulty).toBe(10);
  });
});
