import { describe, expect, it } from "vitest";
import { accuracy, confirmedAt, FORECAST, forecastScore, forecastStudent, forecastTime, lessonSeries, normalCdf, riskOf, smoothWithTrend, type ForecastAttempt } from "./forecast";

const day = (d: number, h = 7) => new Date(Date.UTC(2026, 8, d, h));

function attempt(lesson: number, score: number | null, over: Partial<ForecastAttempt> = {}): ForecastAttempt {
  return {
    lessonId: `l${lesson}`,
    lessonStart: day(lesson),
    kind: "DDS",
    score,
    reviewStatus: "CONFIRMED",
    createdAt: day(lesson, 8),
    reviewedAt: day(lesson, 12),
    timeSec: 20,
    normSec: 30,
    ...over,
  };
}

/** Lessons 1…n with the given averages (two attempts each, ±4 around the average). */
const lessons = (means: number[]) => means.flatMap((m, i) => [attempt(i + 1, m - 4), attempt(i + 1, m + 4)]);

describe("series and smoothing", () => {
  it("averages each lesson and orders lessons by date", () => {
    const s = lessonSeries([attempt(3, 70), attempt(1, 50), attempt(1, 60), attempt(2, 90)]);
    expect(s.map((p) => [p.lessonId, p.mean, p.attempts])).toEqual([
      ["l1", 55, 2],
      ["l2", 90, 1],
      ["l3", 70, 1],
    ]);
  });

  it("follows a steady rise with a trend but does not overshoot on one jump", () => {
    const rise = smoothWithTrend([50, 60, 70, 80]);
    expect(rise.trend).toBeGreaterThan(0);
    expect(rise.next).toBeGreaterThan(70);
    expect(rise.next).toBeLessThanOrEqual(90);
    const jump = smoothWithTrend([60, 60, 60, 90]);
    expect(jump.next).toBeGreaterThan(60);
    expect(jump.next).toBeLessThan(90);
    expect(smoothWithTrend([70, 70, 70]).next).toBe(70);
    expect(rise.oneStep[0]).toBeNull();
  });
});

describe("expected score on the next lesson", () => {
  it("is empty without confirmed lessons: drafts do not count", () => {
    expect(forecastScore([])).toBeNull();
    expect(forecastScore([attempt(1, 90, { reviewStatus: "PENDING" })])).toBeNull();
  });

  it("with one lesson forecasts its average with the wide typical interval", () => {
    const f = forecastScore(lessons([70]))!;
    expect(f.expected).toBe(70);
    expect(f.trend).toBe(0);
    expect(f.sd).toBe(FORECAST.priorSd);
    expect(f.high - f.low).toBeCloseTo(2 * FORECAST.z * FORECAST.priorSd, 0);
    expect(f.baseline).toBe(70);
  });

  it("goes up for a student who improves and beats the plain average", () => {
    const f = forecastScore(lessons([45, 55, 62, 70, 76]))!;
    expect(f.trend).toBeGreaterThan(2);
    expect(f.expected).toBeGreaterThan(f.baseline);
    expect(f.low).toBeLessThan(f.expected);
    expect(f.high).toBeGreaterThan(f.expected);
    expect(f.lessons).toBe(5);
    expect(f.attempts).toBe(10);
  });

  it("narrows the interval for a steady student and widens it for an erratic one", () => {
    const steady = forecastScore(lessons([72, 74, 73, 72, 74, 73]))!;
    const erratic = forecastScore(lessons([40, 90, 45, 95, 40, 90]))!;
    expect(steady.high - steady.low).toBeLessThan(2 * FORECAST.z * FORECAST.priorSd);
    expect(erratic.high - erratic.low).toBeGreaterThan(steady.high - steady.low);
  });

  it("stays within 0–100", () => {
    const top = forecastScore(lessons([90, 95, 99, 100]))!;
    expect(top.expected).toBeLessThanOrEqual(100);
    expect(top.high).toBeLessThanOrEqual(100);
    const bottom = forecastScore(lessons([30, 18, 8, 4]))!;
    expect(bottom.expected).toBeGreaterThanOrEqual(0);
    expect(bottom.low).toBeGreaterThanOrEqual(0);
  });

  it("uses only what was confirmed before the cutoff", () => {
    const list = [
      attempt(1, 60),
      attempt(2, 80),
      // Confirmed only after the cutoff: at the start of lesson 3 it was still a draft.
      attempt(2, 20, { reviewedAt: day(3, 9) }),
      attempt(3, 10),
    ];
    const at = day(3, 7);
    expect(confirmedAt(list, at)).toHaveLength(2);
    expect(forecastScore(list, { cutoff: at })!.series.map((p) => p.mean)).toEqual([60, 80]);
  });
});

describe("chance to meet the time norm", () => {
  it("is Φ of the log-distance to the norm", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 7);
    expect(normalCdf(1.2816)).toBeCloseTo(0.9, 3);
    expect(normalCdf(-1.96)).toBeCloseTo(0.025, 3);
  });

  it("is high for a fast student, low for a slow one, and grows with a looser norm", () => {
    const fast = [15, 18, 20, 17, 16].map((t, i) => attempt(1, 80, { timeSec: t, createdAt: day(1, 8 + i) }));
    const slow = [45, 50, 38, 60, 41].map((t, i) => attempt(1, 60, { timeSec: t, createdAt: day(1, 8 + i) }));
    const f = forecastTime(fast, "DDS")!;
    const s = forecastTime(slow, "DDS")!;
    expect(f.pOnTime).toBeGreaterThan(0.9);
    expect(s.pOnTime).toBeLessThan(0.2);
    expect(f).toMatchObject({ normSec: 30, attempts: 5, onTime: 5 });
    expect(forecastTime(slow, "DDS", { normSec: 60 })!.pOnTime).toBeGreaterThan(s.pOnTime);
  });

  it("looks only at the role of the place and at the recent attempts", () => {
    const list = [
      ...Array.from({ length: 12 }, (_, i) => attempt(1, 70, { timeSec: 90, createdAt: day(1, i) })),
      ...Array.from({ length: 10 }, (_, i) => attempt(2, 70, { timeSec: 12, createdAt: day(2, i) })),
      attempt(2, 70, { kind: "OP112", timeSec: 200, normSec: 65 }),
    ];
    const t = forecastTime(list, "DDS")!;
    expect(t.attempts).toBe(FORECAST.timeWindow);
    expect(t.typicalSec).toBe(12);
    expect(forecastTime(list, "OP112")).toMatchObject({ normSec: 65, attempts: 1, onTime: 0 });
    expect(forecastTime([], "OP112")).toBeNull();
  });
});

describe("risk and the whole forecast", () => {
  it("flags a low expected score or a small chance to meet the norm", () => {
    const low = forecastScore(lessons([50, 52]))!;
    const good = forecastScore(lessons([85, 88]))!;
    expect(riskOf(low, []).atRisk).toBe(true);
    expect(riskOf(good, []).atRisk).toBe(false);
    const late = forecastTime([attempt(1, 90, { timeSec: 55 })], "DDS");
    const r = riskOf(good, [late]);
    expect(r.atRisk).toBe(true);
    expect(r.reasons[0]).toMatch(/ДДС: в норматив/);
  });

  it("puts the score, both roles and the risk together", () => {
    const f = forecastStudent([...lessons([70, 75]), attempt(2, 70, { kind: "OP112", timeSec: 50, normSec: 65 })], { norms: { OP112: 65 } });
    expect(f.score?.lessons).toBe(2);
    expect(f.time.DDS?.normSec).toBe(30);
    expect(f.time.OP112?.normSec).toBe(65);
    expect(f.risk.atRisk).toBe(false);
  });
});

describe("forecast against the fact", () => {
  it("counts the mean absolute error, the naive baseline and the interval hits", () => {
    const acc = accuracy([
      { expected: 70, low: 60, high: 80, baseline: 65, fact: 75 },
      { expected: 50, low: 40, high: 60, baseline: 60, fact: 38 },
      { expected: 80, low: 70, high: 90, baseline: 80, fact: null }, // not reviewed yet
      { expected: null, low: null, high: null, baseline: null, fact: 90 }, // no history
    ]);
    expect(acc).toEqual({ n: 2, mae: 8.5, baselineMae: 16, inside: 1, bias: -3.5 });
    expect(accuracy([])).toEqual({ n: 0, mae: null, baselineMae: null, inside: 0, bias: null });
  });
});
