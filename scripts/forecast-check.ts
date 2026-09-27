/**
 * How good is the score forecast (src/lib/adaptive/forecast.ts) against the naive one — the plain average of
 * past lessons — on synthetic classes: students without growth, learning ones, ones whose scores the adaptive
 * difficulty pulls towards 70, and declining ones; 3–9 lessons each, lesson averages with noise.
 * Prints the mean absolute error of the next-lesson forecast for both methods and the share of facts inside
 * the 80 % interval.
 *
 *   pnpm exec tsx scripts/forecast-check.ts
 */
import { FORECAST, smoothWithTrend, t80 } from "../src/lib/adaptive/forecast";

let seed = 20260927;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const gauss = () => Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());
const between = (a: number, b: number) => a + (b - a) * random();
const clamp = (x: number) => Math.min(100, Math.max(0, x));

const regimes: Record<string, () => (t: number) => number> = {
  "без роста": () => {
    const base = between(40, 90);
    return () => base;
  },
  "учится": () => {
    const [start, gain, tau] = [between(25, 60), between(10, 40), between(1, 4)];
    return (t) => start + gain * (1 - Math.exp(-t / tau));
  },
  "адаптивная сложность": () => {
    const start = between(30, 100);
    return (t) => 70 + (start - 70) * Math.exp(-t / 2);
  },
  "снижается": () => {
    const [start, drop] = [between(60, 95), between(2, 6)];
    return (t) => start - drop * t;
  },
};

console.log("режим                    прогноз  простое среднее  в интервале");
for (const [name, make] of Object.entries(regimes)) {
  let [ours, naive, inside, n] = [0, 0, 0, 0];
  for (let s = 0; s < 4000; s++) {
    const truth = make();
    const noise = between(8, 18);
    const lessons = 3 + Math.floor(random() * 7);
    const values = Array.from({ length: lessons }, (_, t) => clamp(truth(t) + noise * gauss()));
    for (let k = 1; k < lessons; k++) {
      const past = values.slice(0, k);
      const fit = smoothWithTrend(past);
      const misses = past.flatMap((x, i) => (fit.oneStep[i] == null ? [] : [x - fit.oneStep[i]!]));
      const sd = Math.sqrt((FORECAST.priorWeight * FORECAST.priorSd ** 2 + misses.reduce((a, e) => a + e * e, 0)) / (FORECAST.priorWeight + misses.length));
      const half = t80(FORECAST.priorWeight + misses.length) * sd;
      const expected = clamp(fit.next);
      ours += Math.abs(expected - values[k]);
      naive += Math.abs(past.reduce((a, b) => a + b, 0) / past.length - values[k]);
      inside += Math.abs(expected - values[k]) <= half ? 1 : 0;
      n++;
    }
  }
  console.log(`${name.padEnd(24)} ${(ours / n).toFixed(1).padStart(7)}  ${(naive / n).toFixed(1).padStart(15)}  ${((100 * inside) / n).toFixed(0).padStart(10)} %`);
}
