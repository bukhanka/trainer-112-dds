import { describe, expect, it } from "vitest";
import check from "./forecast-check.json";
import { accuracy, combineForecast, confirmedAt, FORECAST, forecastScore, forecastScores, forecastStudent, forecastTime, lessonSeries, normalCdf, riskOf, smoothWithTrend, t80, type ForecastAttempt } from "./forecast";

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
    expect(f.high - f.low).toBeCloseTo(2 * t80(FORECAST.priorWeight) * FORECAST.priorSd, 0);
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
    const first = forecastScore(lessons([73]))!;
    const steady = forecastScore(lessons([72, 74, 73, 72, 74, 73]))!;
    const erratic = forecastScore(lessons([40, 90, 45, 95, 40, 90]))!;
    expect(steady.high - steady.low).toBeLessThan((first.high - first.low) / 1.5);
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

describe("the group: classmates' lessons", () => {
  /** A classmate with these lesson averages on lessons 1…n. */
  const mate = (means: number[]) => lessons(means);

  it("pulls a newcomer towards the group, less so with every own lesson", () => {
    const group = [mate([75]), mate([80]), mate([70])];
    const one = forecastScore(lessons([40]), { peers: group })!;
    expect(one.group).toBe(75);
    expect(one.expected).toBeGreaterThan(40);
    expect(one.expected).toBeLessThan(75);
    const three = forecastScore(lessons([40, 40, 40]), { peers: [mate([75, 75, 75]), mate([80, 80, 80]), mate([70, 70, 70])] })!;
    expect(Math.abs(three.pull)).toBeLessThan(Math.abs(one.pull));
    // Without classmates there is nothing to pull to.
    expect(forecastScore(lessons([40]))!.pull).toBe(0);
  });

  it("barely moves a student at the top of the scale", () => {
    // The same distance to the group (about 40 points) moves a student in the middle of the scale far more.
    const top = forecastScore(lessons([100, 100]), { peers: [mate([55, 60]), mate([60, 65]), mate([50, 55])] })!;
    const middle = forecastScore(lessons([50, 50]), { peers: [mate([85, 90]), mate([90, 95]), mate([80, 85])] })!;
    expect(top.expected).toBeGreaterThan(95);
    expect(middle.pull).toBeGreaterThan(10);
    expect(Math.abs(top.pull)).toBeLessThan(middle.pull / 3);
  });

  it("mixes the plain average and the trend half and half", () => {
    const values = [45, 55, 62, 70, 76];
    const f = combineForecast(values, null);
    const holt = smoothWithTrend(values).next;
    expect(f.expected).toBeCloseTo((f.plain + holt) / 2, 6);
  });

  it("widens the interval when the group's lessons jump and keeps it narrower for a steady group", () => {
    const own = lessons([70, 72]);
    const steady = forecastScore(own, { peers: [mate([70, 71]), mate([60, 61]), mate([80, 79]), mate([65, 66])] })!;
    const jumpy = forecastScore(own, { peers: [mate([40, 90]), mate([95, 45]), mate([30, 80]), mate([85, 35])] })!;
    expect(jumpy.high - jumpy.low).toBeGreaterThan(steady.high - steady.low);
    expect(jumpy.misses).toEqual({ own: 1, peers: 4 });
  });

  it("uses only what classmates had confirmed by the cutoff", () => {
    const later = attempt(9, 10, { createdAt: day(9, 8), reviewedAt: day(9, 12) });
    const f = forecastScore(lessons([60, 62]), { cutoff: day(5), peers: [[...mate([70, 72]), later]] })!;
    expect(f.group).toBe(71);
  });

  it("gives the same numbers for one student and for the whole class at once", () => {
    const histories = new Map<string, ForecastAttempt[]>([
      ["a", lessons([50, 60, 65])],
      ["b", lessons([80, 78, 85])],
      ["c", lessons([70, 65, 72])],
    ]);
    const all = forecastScores(histories, { peersOf: () => ["a", "b", "c"] });
    const alone = forecastScore(histories.get("a")!, { peers: [histories.get("b")!, histories.get("c")!] })!;
    expect(all.get("a")).toEqual(alone);
  });
});

describe("the synthetic check shown on «Отчёты»", () => {
  it("was run with the current weights of the method (scripts/forecast-check.ts)", () => {
    const { trendWeight, groupPull, priorSd, priorWeight, peerWeight } = FORECAST;
    expect(check.params).toEqual({ trendWeight, groupPull, priorSd, priorWeight, peerWeight });
    expect(check.overall.mae).toBeLessThan(check.overall.naive);
    expect(Object.keys(check.profiles)).toHaveLength(5);
  });
});

describe("interval width", () => {
  it("uses Student's quantile: wider with little history, the normal 1.28 in the long run", () => {
    expect(t80(2)).toBeCloseTo(1.886, 3);
    expect(t80(5)).toBeLessThan(t80(3));
    expect(t80(1000)).toBeCloseTo(1.2816, 4);
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
    // Paired: 10 − 5 and 22 − 12 points closer than the plain average → 7.5 ± 2.5.
    expect(acc).toEqual({ n: 2, mae: 8.5, baselineMae: 16, gain: 7.5, gainSe: 2.5, inside: 1, bias: -3.5 });
    expect(accuracy([])).toEqual({ n: 0, mae: null, baselineMae: null, gain: null, gainSe: null, inside: 0, bias: null });
  });
});
