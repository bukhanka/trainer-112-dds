/**
 * How good is the score forecast (src/lib/adaptive/forecast.ts) against the naive one — the plain average of
 * past lessons — on synthetic classes. Every class is 4–12 students with 3–9 lessons; before every lesson each
 * student's next average is forecast exactly as at a lesson start: from the lessons before it, with the
 * classmates as the group. Five student profiles: no growth, learning, pulled towards 70 by the adaptive
 * difficulty, declining, at the top of the scale; half of the classes are dominated by one profile.
 *
 * Two families of classes, so that the choice does not hang on one way of making noise:
 *   gauss  — a lesson average is the student's level plus Gaussian noise (8–22 points per attempt),
 *            1–3 attempts per lesson, now and then an attempt capped at 40 as by a critical error;
 *   checks — attempts are scored like the trainer does: 7 groups of 2–5 checks with weights, a failed
 *            critical check caps the attempt at 40; the student's level is the share of checks passed.
 * A common shock per lesson (a harder topic for everybody) is added in both.
 *
 * The weights of the method (half trend, pull to the group, the typical miss of 13 points) were chosen on
 * seed 11; this report uses another seed. «до» is the method before 28.09: Holt's smoothing alone with the
 * interval from the student's own misses. Writes src/lib/adaptive/forecast-check.json for the «Отчёты» page.
 *
 *   pnpm exec tsx scripts/forecast-check.ts [--seed 2026] [--classes 2000]
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { FORECAST, forecastScores, smoothWithTrend, t80, type ForecastAttempt } from "../src/lib/adaptive/forecast";

const arg = (name: string, fallback: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : fallback;
};
const SEED = arg("seed", 2026);
const CLASSES = arg("classes", 2000);

let seed = SEED;
const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const gauss = () => Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());
const between = (a: number, b: number) => a + (b - a) * random();
const clamp = (x: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, x));
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

const PROFILES = ["без роста", "учится", "адаптивная сложность", "снижается", "у потолка"] as const;
type Profile = (typeof PROFILES)[number];

/** Share of checks passed (0–1) on the lesson t = 0, 1, 2… */
function levelOf(profile: Profile): (t: number) => number {
  switch (profile) {
    case "без роста": {
      const b = between(0.45, 0.9);
      return () => b;
    }
    case "учится": {
      const [s, g, tau] = [between(0.3, 0.6), between(0.15, 0.4), between(1, 4)];
      return (t) => Math.min(0.99, s + g * (1 - Math.exp(-t / tau)));
    }
    case "адаптивная сложность": {
      const s = between(0.35, 0.98);
      return (t) => 0.72 + (s - 0.72) * Math.exp(-t / 2);
    }
    case "снижается": {
      const [s, d] = [between(0.65, 0.95), between(0.02, 0.06)];
      return (t) => Math.max(0.1, s - d * t);
    }
    case "у потолка": {
      const b = between(0.93, 0.995);
      return () => b;
    }
  }
}

function attemptScore(family: "gauss" | "checks", level: number, shock: number): number {
  if (family === "gauss") {
    const s = clamp(100 * level + shock + (8 + 14 * random()) * gauss());
    return random() < 0.06 ? Math.min(s, 40) : s;
  }
  const pFail = Math.min(0.95, Math.max(0.005, 1 - level - gauss() * 0.08 - shock / 100));
  const weights = [1, 1, 1.5, 1, 1.5, 1, 0.5];
  let passed = 0;
  for (const w of weights) {
    const k = 2 + Math.floor(random() * 4);
    let ok = 0;
    for (let i = 0; i < k; i++) ok += random() < pFail ? 0 : 1;
    passed += (w * ok) / k;
  }
  const s = (100 * passed) / weights.reduce((a, b) => a + b, 0);
  return random() < pFail * 0.35 ? Math.min(s, 40) : s;
}

type Student = { profile: Profile; values: number[] };

function makeClass(family: "gauss" | "checks"): Student[] {
  const size = 4 + Math.floor(random() * 9);
  const lessons = 3 + Math.floor(random() * 7);
  const shockSd = between(0, 6);
  const shocks = Array.from({ length: lessons }, () => shockSd * gauss());
  const main = random() < 0.5 ? null : PROFILES[Math.floor(random() * PROFILES.length)];
  return Array.from({ length: size }, () => {
    const profile = main && random() < 0.6 ? main : PROFILES[Math.floor(random() * PROFILES.length)];
    const level = levelOf(profile);
    const values = Array.from({ length: lessons }, (_, t) => mean(Array.from({ length: 1 + Math.floor(random() * 3) }, () => attemptScore(family, level(t), shocks[t]))));
    return { profile, values };
  });
}

/** The method before 28.09: Holt alone, the interval from the student's own misses with 2 typical ones of 12 points. */
function before(values: number[]) {
  const fit = smoothWithTrend(values);
  const misses = values.flatMap((x, i) => (fit.oneStep[i] == null ? [] : [x - fit.oneStep[i]!]));
  const sd = Math.sqrt((2 * 12 ** 2 + misses.reduce((a, e) => a + e * e, 0)) / (2 + misses.length));
  return { expected: clamp(fit.next), half: t80(2 + misses.length) * sd };
}

const day = (d: number, h: number) => new Date(Date.UTC(2026, 0, 1 + d, h));
const toAttempts = (values: number[]): ForecastAttempt[] =>
  values.map((score, t) => ({ lessonId: `l${t}`, lessonStart: day(t, 7), kind: "DDS", score, reviewStatus: "CONFIRMED", createdAt: day(t, 8), reviewedAt: day(t, 12), timeSec: null, normSec: null }));

type Cell = { n: number; ours: number; naive: number; before: number; inside: number; insideBefore: number; width: number };
const cell = (): Cell => ({ n: 0, ours: 0, naive: 0, before: 0, inside: 0, insideBefore: 0, width: 0 });
const table = new Map<string, Cell>();
const add = (keys: string[], e: { ours: number; naive: number; before: number; inside: boolean; insideBefore: boolean; width: number }) => {
  for (const k of keys) {
    const c = table.get(k) ?? cell();
    c.n++;
    c.ours += e.ours;
    c.naive += e.naive;
    c.before += e.before;
    c.inside += e.inside ? 1 : 0;
    c.insideBefore += e.insideBefore ? 1 : 0;
    c.width += e.width;
    table.set(k, c);
  }
};

for (const family of ["gauss", "checks"] as const) {
  for (let c = 0; c < CLASSES; c++) {
    const cls = makeClass(family);
    const ids = cls.map((_, i) => `s${i}`);
    const histories = new Map(cls.map((st, i) => [ids[i], toAttempts(st.values)]));
    for (let k = 1; k < cls[0].values.length; k++) {
      const scores = forecastScores(histories, { cutoff: day(k, 7), peersOf: () => ids });
      cls.forEach((st, i) => {
        const f = scores.get(ids[i])!;
        const past = st.values.slice(0, k);
        const x = st.values[k];
        const b = before(past);
        const history = k >= 5 ? "5+" : String(k);
        add(["всё", `${family}`, `профиль: ${st.profile}`, `история: ${history}`], {
          ours: Math.abs(x - f.expected),
          naive: Math.abs(x - mean(past)),
          before: Math.abs(x - b.expected),
          inside: x >= f.low && x <= f.high,
          insideBefore: Math.abs(x - b.expected) <= b.half,
          width: f.high - f.low,
        });
      });
    }
  }
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const summary = (c: Cell) => ({
  n: c.n,
  mae: r1(c.ours / c.n),
  naive: r1(c.naive / c.n),
  before: r1(c.before / c.n),
  coverage: Math.round((100 * c.inside) / c.n),
  coverageBefore: Math.round((100 * c.insideBefore) / c.n),
  width: r1(c.width / c.n),
});

console.log(`сид ${SEED}, классов ${CLASSES} на семейство; ошибка — средняя абсолютная, баллы`);
console.log("срез                             прогнозов   сейчас  простое среднее   до    покрытие (до)   ширина");
for (const [key, c] of table) {
  const s = summary(c);
  console.log(
    `${key.padEnd(32)} ${String(s.n).padStart(9)} ${s.mae.toFixed(1).padStart(8)} ${s.naive.toFixed(1).padStart(16)} ${s.before.toFixed(1).padStart(5)} ${`${s.coverage} % (${s.coverageBefore} %)`.padStart(15)} ${s.width.toFixed(1).padStart(8)}`,
  );
}

const pick = (prefix: string) => Object.fromEntries([...table].filter(([k]) => k.startsWith(prefix)).map(([k, c]) => [k.slice(prefix.length), summary(c)]));
const out = {
  seed: SEED,
  classes: CLASSES,
  params: { trendWeight: FORECAST.trendWeight, groupPull: FORECAST.groupPull, priorSd: FORECAST.priorSd, priorWeight: FORECAST.priorWeight, peerWeight: FORECAST.peerWeight },
  overall: summary(table.get("всё")!),
  families: { gauss: summary(table.get("gauss")!), checks: summary(table.get("checks")!) },
  profiles: pick("профиль: "),
  history: pick("история: "),
};
writeFileSync(path.join(__dirname, "..", "src", "lib", "adaptive", "forecast-check.json"), `${JSON.stringify(out, null, 2)}\n`);
