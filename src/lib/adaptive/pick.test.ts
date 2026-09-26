import { describe, expect, it } from "vitest";
import { closeness, pickAdaptive } from "./pick";

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The approved pool of the demo: difficulties 2–7, most of them 2, 3 and 6.
const pool = [2, 2, 2, 3, 3, 3, 4, 5, 6, 6, 6, 6, 6, 7, 7].map((difficulty, i) => ({ id: `s${i}`, difficulty }));

function histogram(target: number, draws = 4000) {
  const random = seeded(target * 97 + 1);
  const counts = new Map<number, number>();
  for (let i = 0; i < draws; i++) {
    const s = pickAdaptive(pool, { target, random })!;
    counts.set(s.difficulty, (counts.get(s.difficulty) ?? 0) + 1);
  }
  const mean = [...counts.entries()].reduce((a, [d, n]) => a + d * n, 0) / draws;
  return { counts, mean };
}

describe("adaptive choice of the next task", () => {
  it("weighs difficulties by closeness to the recommended one", () => {
    expect(closeness(4, 4)).toBe(1);
    expect(closeness(5, 4)).toBeCloseTo(Math.exp(-0.5), 6);
    expect(closeness(3, 4)).toBe(closeness(5, 4));
    expect(closeness(7, 4)).toBeLessThan(0.02);
  });

  it("deals mostly tasks near the level, with some spread", () => {
    const easy = histogram(2);
    const hard = histogram(6);
    expect(easy.mean).toBeLessThan(3);
    expect(hard.mean).toBeGreaterThan(5.3);
    // Not a fixed difficulty: neighbours come too, far ones rarely.
    expect(easy.counts.get(3)).toBeGreaterThan(400);
    expect(easy.counts.get(7) ?? 0).toBeLessThan(40);
    expect(hard.counts.get(5)).toBeGreaterThan(100);
  });

  it("follows the level: a stronger student gets harder tasks on average", () => {
    const means = [2, 3, 4, 5, 6].map((t) => histogram(t).mean);
    for (let i = 1; i < means.length; i++) expect(means[i]).toBeGreaterThan(means[i - 1]);
  });

  it("does not repeat a scenario while there are fresh ones", () => {
    const random = seeded(7);
    const lastUsed = new Map<string, number>();
    for (let i = 0; i < pool.length; i++) {
      const s = pickAdaptive(pool, { target: 4, lastUsed, random })!;
      expect(lastUsed.has(s.id)).toBe(false);
      lastUsed.set(s.id, i);
    }
    expect(lastUsed.size).toBe(pool.length);
  });

  it("after the pool runs out brings back an old one, never the task just done", () => {
    const small = pool.slice(0, 4);
    const lastUsed = new Map(small.map((s, i) => [s.id, 1000 + i]));
    for (let seed = 1; seed < 50; seed++) {
      const s = pickAdaptive(small, { target: 3, lastUsed, random: seeded(seed) })!;
      expect(["s0", "s1"]).toContain(s.id);
    }
  });

  it("works with one candidate and with an empty pool", () => {
    expect(pickAdaptive([], { target: 3 })).toBeNull();
    const one = [{ id: "only", difficulty: 9 }];
    expect(pickAdaptive(one, { target: 1 })?.id).toBe("only");
    expect(pickAdaptive(one, { target: 1, lastUsed: new Map([["only", 1]]) })?.id).toBe("only");
  });
});
