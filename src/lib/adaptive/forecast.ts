/**
 * Forecast of a student's next lesson. Only attempts the teacher has confirmed count: a draft is not
 * a result yet.
 *
 * Expected score. Every past lesson gives one point — the average confirmed score of the student on
 * it. Two simple forecasts are mixed half and half:
 *   - the plain average of the student's past lessons;
 *   - Holt's smoothing with a damped trend: level ← α·x + (1 − α)·(level + φ·trend),
 *     trend ← β·(new level − old level) + (1 − β)·φ·trend; its forecast is level + φ·trend.
 * Then the result is pulled towards the group — the average of the classmates' past lessons — as if the
 * student had κ more lessons at the group's level: pulled = (n·mean + k·group) / (n + k). The pull fades
 * with the student's own history (n) and near the ends of the scale (k = κ·x(100 − x)/2500, a score
 * near 100 is steady, the group must not drag a top student down). No classmates — no pull.
 * The weights were chosen on synthetic classes (scripts/forecast-check.ts), not on the demo lessons.
 *
 * Interval: ±t·σ, meant to hold the fact 8 times out of 10. σ is how far the same method missed on
 * past lessons — the student's own misses and, at half weight, the classmates' ones (a rolling check:
 * each past lesson is predicted only from what came before it), mixed with a typical miss of 13 points
 * while there is little history. t is Student's 80 % quantile: wider when few misses have been seen.
 *
 * Meeting the time norm. From the last confirmed attempts in the role of the place: the logarithm of
 * the time is treated as normally distributed (times are skewed — a few long ones), so
 *     P(time ≤ norm) = Φ((ln norm − mean ln time) / spread),
 * the spread again pulled towards a typical one while there are few attempts.
 */
import type { RatingRole } from "./rating";

export const FORECAST = {
  alpha: 0.4,
  beta: 0.2,
  /** Damping of the trend: a short noisy series should not extrapolate a run of lessons at full slope. */
  phi: 0.8,
  /** Share of the trend forecast; the rest is the plain average of past lessons. */
  trendWeight: 0.5,
  /** Pull to the group: as many extra lessons at the group's level (in the middle of the scale). */
  groupPull: 1,
  /** Near 0 and 100 the pull fades to this share of groupPull, not to nothing. */
  groupPullFloor: 0.15,
  /** A classmate's past miss counts this much against the student's own in the interval. */
  peerWeight: 0.5,
  /** Typical miss of a lesson average while there is little history, points. */
  priorSd: 13,
  /** How many «typical» misses are mixed with the observed ones. */
  priorWeight: 3,
  /** Share of facts the interval is meant to hold. */
  coverage: 0.8,
  /** Last attempts of a role used for the time forecast. */
  timeWindow: 10,
  /** Typical spread of ln(time): about ±35 %… */
  timePriorSd: 0.35,
  /** …mixed in as this many attempts. */
  timePriorWeight: 2,
  /** Risk: expected score below this… */
  riskScore: 60,
  /** …or the chance to meet the norm below this. */
  riskOnTime: 0.5,
} as const;

export type ForecastAttempt = {
  lessonId: string;
  lessonStart: Date | null;
  kind: RatingRole;
  score: number | null;
  reviewStatus: "PENDING" | "CONFIRMED" | "OVERRIDDEN";
  createdAt: Date;
  reviewedAt: Date | null;
  /** 112: card typing time; ДДС: «Добавлена» → the card opened — as in the lesson report. */
  timeSec: number | null;
  /** The norm of the lesson for this time. */
  normSec: number | null;
};

export type LessonPoint = { lessonId: string; date: Date; mean: number; attempts: number };

export type ScoreForecast = {
  expected: number;
  low: number;
  high: number;
  /** Points per lesson (Holt's trend; half of the forecast follows it). */
  trend: number;
  /** Plain average of the past lessons: the naive forecast to compare with. */
  baseline: number;
  /** Average of the classmates' past lessons, if any had confirmed lessons. */
  group: number | null;
  /** How far the pull to the group moved the forecast, points. */
  pull: number;
  sd: number;
  lessons: number;
  attempts: number;
  /** Past misses behind the interval: the student's own and the classmates'. */
  misses: { own: number; peers: number };
  series: LessonPoint[];
};

export type TimeForecast = {
  role: RatingRole;
  normSec: number;
  /** Chance to meet the norm next time, 0–1. */
  pOnTime: number;
  /** Typical time (geometric mean) of the recent attempts. */
  typicalSec: number;
  attempts: number;
  /** How many of them met their lesson's norm. */
  onTime: number;
};

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Student's t, 0.9 quantile (two-sided 80 %), by degrees of freedom; the normal 1.2816 beyond the table. */
const T80: [number, number][] = [
  [1, 3.078],
  [2, 1.886],
  [3, 1.638],
  [4, 1.533],
  [5, 1.476],
  [6, 1.44],
  [7, 1.415],
  [8, 1.397],
  [9, 1.383],
  [10, 1.372],
  [12, 1.356],
  [15, 1.341],
  [20, 1.325],
  [30, 1.31],
];

export function t80(df: number): number {
  for (const [d, t] of T80) if (df <= d) return t;
  return 1.2816;
}
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Confirmed attempts with a score, as they stood at `cutoff` (e.g. the start of a lesson). */
export function confirmedAt<T extends ForecastAttempt>(attempts: T[], cutoff?: Date): T[] {
  return attempts.filter(
    (a) =>
      a.reviewStatus !== "PENDING" &&
      a.score != null &&
      Number.isFinite(a.score) &&
      (!cutoff || (a.createdAt < cutoff && (!a.reviewedAt || a.reviewedAt <= cutoff))),
  );
}

/** One point per lesson: the average confirmed score, in the order the lessons took place. */
export function lessonSeries(attempts: ForecastAttempt[]): LessonPoint[] {
  const by = new Map<string, { date: Date; scores: number[] }>();
  for (const a of attempts) {
    if (a.score == null) continue;
    const e = by.get(a.lessonId) ?? { date: a.lessonStart ?? a.createdAt, scores: [] };
    if (!a.lessonStart && a.createdAt < e.date) e.date = a.createdAt;
    e.scores.push(a.score);
    by.set(a.lessonId, e);
  }
  return [...by.entries()]
    .map(([lessonId, e]) => ({ lessonId, date: e.date, mean: e.scores.reduce((x, y) => x + y, 0) / e.scores.length, attempts: e.scores.length }))
    .sort((a, b) => a.date.getTime() - b.date.getTime() || (a.lessonId < b.lessonId ? -1 : 1));
}

/**
 * Holt's smoothing with a trend. `oneStep[i]` is what the method expected for values[i] before
 * seeing it (none for the first value).
 */
export function smoothWithTrend(values: number[], alpha: number = FORECAST.alpha, beta: number = FORECAST.beta, phi: number = FORECAST.phi) {
  if (!values.length) return { level: NaN, trend: 0, next: NaN, oneStep: [] as (number | null)[] };
  let level = values[0];
  let trend = 0;
  const oneStep: (number | null)[] = [null];
  for (const x of values.slice(1)) {
    const expected = level + phi * trend;
    oneStep.push(expected);
    const next = alpha * x + (1 - alpha) * expected;
    trend = beta * (next - level) + (1 - beta) * phi * trend;
    level = next;
  }
  return { level, trend, next: level + phi * trend, oneStep };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** The forecast of the next lesson from the past lesson averages and the group's average (null — no group). */
export function combineForecast(values: number[], group: number | null) {
  const n = values.length;
  const plain = mean(values);
  const fit = smoothWithTrend(values);
  const holt = clamp(fit.next, 0, 100);
  const k = group == null ? 0 : FORECAST.groupPull * Math.max(FORECAST.groupPullFloor, (plain * (100 - plain)) / 2500);
  const pulled = group == null ? plain : (n * plain + k * group) / (n + k);
  return { expected: clamp(pulled + FORECAST.trendWeight * (holt - plain), 0, 100), plain, holt, pull: pulled - plain, trend: fit.trend };
}

type Timed = { date: Date; mean: number };

/** Average over the classmates of their lessons before `before` (all of them without a date); null — none had any. */
function groupAverage(others: Timed[][], before?: Date): number | null {
  const means: number[] = [];
  for (const s of others) {
    const past = before ? s.filter((p) => p.date < before) : s;
    if (past.length) means.push(mean(past.map((p) => p.mean)));
  }
  return means.length ? mean(means) : null;
}

/** Rolling check: every lesson after the first predicted from the lessons before it (and the group as it was then). */
function rollingMisses(series: Timed[], others: Timed[][]): number[] {
  const out: number[] = [];
  for (let j = 1; j < series.length; j++) {
    const f = combineForecast(series.slice(0, j).map((p) => p.mean), groupAverage(others, series[j].date));
    out.push(series[j].mean - f.expected);
  }
  return out;
}

const sumSq = (xs: number[]) => xs.reduce((a, e) => a + e * e, 0);

/**
 * Forecasts of several students at once, each against the classmates `peersOf` returns (by default — nobody).
 * The classmates' rolling misses are computed once per group, so a class of 30 costs next to nothing.
 */
export function forecastScores(
  histories: Map<string, ForecastAttempt[]>,
  opts: { cutoff?: Date; peersOf?: (id: string) => string[] } = {},
): Map<string, ScoreForecast | null> {
  const confirmed = new Map([...histories].map(([id, list]) => [id, confirmedAt(list, opts.cutoff)]));
  const series = new Map([...confirmed].map(([id, list]) => [id, lessonSeries(list)]));
  const timed = (id: string): Timed[] => (series.get(id) ?? []).map((p) => ({ date: p.date, mean: p.mean }));
  // Misses of a student inside a group (the student and the classmates), cached per group.
  const cache = new Map<string, Map<string, number[]>>();
  const missesIn = (members: string[]) => {
    const key = [...members].sort().join(" ");
    let got = cache.get(key);
    if (!got) {
      got = new Map(members.map((id) => [id, rollingMisses(timed(id), members.filter((o) => o !== id).map(timed))]));
      cache.set(key, got);
    }
    return got;
  };
  const out = new Map<string, ScoreForecast | null>();
  for (const [id, own] of series) {
    if (!own.length) {
      out.set(id, null);
      continue;
    }
    const peers = [...new Set(opts.peersOf?.(id) ?? [])].filter((p) => p !== id && series.has(p));
    const values = own.map((p) => p.mean);
    const group = groupAverage(peers.map(timed));
    const f = combineForecast(values, group);
    const misses = peers.length ? missesIn([id, ...peers]) : new Map([[id, rollingMisses(timed(id), [])]]);
    const ownMisses = misses.get(id) ?? [];
    const peerMisses = peers.flatMap((p) => misses.get(p) ?? []);
    const weight = FORECAST.priorWeight + ownMisses.length + FORECAST.peerWeight * peerMisses.length;
    const sd = Math.sqrt((FORECAST.priorWeight * FORECAST.priorSd ** 2 + sumSq(ownMisses) + FORECAST.peerWeight * sumSq(peerMisses)) / weight);
    const half = t80(Math.round(weight)) * sd;
    out.set(id, {
      expected: round1(f.expected),
      low: round1(clamp(f.expected - half, 0, 100)),
      high: round1(clamp(f.expected + half, 0, 100)),
      trend: round1(f.trend),
      baseline: round1(f.plain),
      group: group == null ? null : round1(group),
      pull: round1(f.pull),
      sd: round1(sd),
      lessons: own.length,
      attempts: confirmed.get(id)!.length,
      misses: { own: ownMisses.length, peers: peerMisses.length },
      series: own,
    });
  }
  return out;
}

/** One student's forecast; `peers` — the classmates' attempts, if the group should be taken into account. */
export function forecastScore(attempts: ForecastAttempt[], opts: { cutoff?: Date; peers?: ForecastAttempt[][] } = {}): ScoreForecast | null {
  const histories = new Map<string, ForecastAttempt[]>([["self", attempts], ...(opts.peers ?? []).map((p, i): [string, ForecastAttempt[]] => [`peer${i}`, p])]);
  const peers = [...histories.keys()].filter((k) => k !== "self");
  return forecastScores(histories, { cutoff: opts.cutoff, peersOf: (id) => (id === "self" ? peers : []) }).get("self") ?? null;
}

/** Standard normal distribution function (Abramowitz–Stegun 7.1.26, error below 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Chance that the next time in this role fits `normSec` (by default the norm of the latest lesson). */
export function forecastTime(attempts: ForecastAttempt[], role: RatingRole, opts: { normSec?: number | null; cutoff?: Date } = {}): TimeForecast | null {
  const recent = confirmedAt(attempts, opts.cutoff)
    .filter((a) => a.kind === role && a.timeSec != null && a.timeSec > 0)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(-FORECAST.timeWindow);
  const normSec = opts.normSec ?? recent.at(-1)?.normSec ?? null;
  if (!recent.length || !normSec) return null;
  const logs = recent.map((a) => Math.log(a.timeSec!));
  const mean = logs.reduce((a, b) => a + b, 0) / logs.length;
  const spread = Math.sqrt(
    (FORECAST.timePriorWeight * FORECAST.timePriorSd ** 2 + logs.reduce((a, l) => a + (l - mean) ** 2, 0)) / (FORECAST.timePriorWeight + logs.length - 1),
  );
  return {
    role,
    normSec,
    pOnTime: Math.round(normalCdf((Math.log(normSec) - mean) / spread) * 100) / 100,
    typicalSec: Math.round(Math.exp(mean)),
    attempts: recent.length,
    onTime: recent.filter((a) => a.timeSec! <= (a.normSec ?? normSec)).length,
  };
}

export type Risk = { atRisk: boolean; reasons: string[] };

export function riskOf(score: ScoreForecast | null, times: (TimeForecast | null)[]): Risk {
  const reasons: string[] = [];
  // Compare the numbers the teacher sees: 59.6 is shown as 60 and is not «below 60».
  if (score && Math.round(score.expected) < FORECAST.riskScore) reasons.push(`ожидаемый балл ${Math.round(score.expected)} — ниже ${FORECAST.riskScore}`);
  for (const t of times) {
    if (t && Math.round(t.pOnTime * 100) < FORECAST.riskOnTime * 100) reasons.push(`${t.role === "OP112" ? "112" : "ДДС"}: в норматив — ${Math.round(t.pOnTime * 100)} %`);
  }
  return { atRisk: reasons.length > 0, reasons };
}

export type StudentForecast = {
  score: ScoreForecast | null;
  time: Record<RatingRole, TimeForecast | null>;
  risk: Risk;
};

export function forecastStudent(
  attempts: ForecastAttempt[],
  opts: { cutoff?: Date; norms?: Partial<Record<RatingRole, number>>; score?: ScoreForecast | null } = {},
): StudentForecast {
  // The score may come precomputed with the group (forecastScores); alone — without it.
  const score = opts.score !== undefined ? opts.score : forecastScore(attempts, { cutoff: opts.cutoff });
  const time = {
    OP112: forecastTime(attempts, "OP112", { cutoff: opts.cutoff, normSec: opts.norms?.OP112 }),
    DDS: forecastTime(attempts, "DDS", { cutoff: opts.cutoff, normSec: opts.norms?.DDS }),
  };
  return { score, time, risk: riskOf(score, [time.OP112, time.DDS]) };
}

// ─── forecast against the fact ──────────────────────────────────────────────

export type ForecastVsFact = { expected: number | null; low: number | null; high: number | null; baseline: number | null; fact: number | null };

export type Accuracy = {
  /** Pairs where both the forecast and the fact exist. */
  n: number;
  /** Mean absolute error of the forecast, points. */
  mae: number | null;
  /** The same for the plain average of past lessons. */
  baselineMae: number | null;
  /** baselineMae − mae over the pairs with both: positive — the forecast is closer to the fact. */
  gain: number | null;
  /** Standard error of that difference (paired): |gain| under 2·gainSe is within chance. */
  gainSe: number | null;
  /** Facts inside the 80 % interval. */
  inside: number;
  /** Mean of fact − forecast: positive — the students did better than forecast. */
  bias: number | null;
};

export function accuracy(rows: ForecastVsFact[]): Accuracy {
  const pairs = rows.filter((r) => r.expected != null && r.fact != null);
  if (!pairs.length) return { n: 0, mae: null, baselineMae: null, gain: null, gainSe: null, inside: 0, bias: null };
  const base = pairs.filter((r) => r.baseline != null);
  // Paired: for the same student and lesson, how much closer the forecast came than the plain average.
  const diffs = base.map((r) => Math.abs(r.fact! - r.baseline!) - Math.abs(r.fact! - r.expected!));
  const gain = diffs.length ? mean(diffs) : null;
  const gainSe = diffs.length > 1 ? Math.sqrt(diffs.reduce((a, d) => a + (d - gain!) ** 2, 0) / (diffs.length - 1) / diffs.length) : null;
  return {
    n: pairs.length,
    mae: round1(mean(pairs.map((r) => Math.abs(r.fact! - r.expected!)))),
    baselineMae: base.length ? round1(mean(base.map((r) => Math.abs(r.fact! - r.baseline!)))) : null,
    gain: gain == null ? null : round1(gain),
    gainSe: gainSe == null ? null : round1(gainSe),
    inside: pairs.filter((r) => r.low != null && r.high != null && r.fact! >= r.low && r.fact! <= r.high).length,
    bias: round1(mean(pairs.map((r) => r.fact! - r.expected!))),
  };
}
