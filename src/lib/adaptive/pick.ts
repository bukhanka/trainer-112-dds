/**
 * Adaptive choice of the next task for a place without tasks assigned by the teacher.
 *
 * Every candidate scenario gets a weight by how close its difficulty is to the difficulty the
 * student's level recommends: exp(−(d − target)² / (2·spread²)). The draw is random by these weights,
 * so tasks come mostly of the recommended difficulty, sometimes a step easier or harder, and rarely
 * two steps away. Scenarios the place has already had are skipped until the pool runs out; after
 * that the one seen longest ago comes back, never the one just shown.
 */

export type Candidate = { id: string; difficulty: number | null };

export const PICK = {
  /** One difficulty step away gets ~0.6 of the weight, two steps ~0.14, three ~0.01. */
  spread: 1,
} as const;

export function closeness(difficulty: number | null, target: number, spread: number = PICK.spread): number {
  const d = (difficulty ?? 3) - target;
  return Math.exp(-(d * d) / (2 * spread * spread));
}

/**
 * `lastUsed` maps a scenario id to the time (ms) it was last shown at this place. `random` returns
 * a number in [0, 1), Math.random by default; tests and the demo seed pass a seeded one.
 */
export function pickAdaptive<T extends Candidate>(
  pool: T[],
  opts: { target: number; lastUsed?: Map<string, number>; random?: () => number; spread?: number },
): T | null {
  if (!pool.length) return null;
  const lastUsed = opts.lastUsed ?? new Map<string, number>();
  const fresh = pool.filter((s) => !lastUsed.has(s.id));
  let candidates = fresh;
  if (!candidates.length) {
    // Everything was shown: bring back the older half, so the task just done does not repeat.
    const byAge = [...pool].sort((a, b) => (lastUsed.get(a.id) ?? 0) - (lastUsed.get(b.id) ?? 0));
    candidates = byAge.slice(0, Math.max(1, Math.ceil(byAge.length / 2)));
  }
  const weights = candidates.map((s) => closeness(s.difficulty, opts.target, opts.spread));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = (opts.random ?? Math.random)() * total;
  for (const [i, w] of weights.entries()) {
    r -= w;
    if (r < 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}
