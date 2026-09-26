import { afterEach, describe, expect, it, vi } from "vitest";

async function freshProvider(env: Record<string, string>) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return import("./provider");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("takeCall — budget guard", () => {
  it("stops at the per-minute limit and opens again in the next minute", async () => {
    const { takeCall } = await freshProvider({ AI_MAX_CALLS_PER_MIN: "2" });
    const t = Date.UTC(2026, 8, 30, 10, 0, 0);
    expect([takeCall("chat", t), takeCall("chat", t + 1), takeCall("chat", t + 2)]).toEqual([true, true, false]);
    expect(takeCall("voice", t + 3)).toBe(true); // speech is counted apart
    expect(takeCall("chat", t + 61_000)).toBe(true);
  });

  it("stops at the daily limit until the next day, refused calls do not count", async () => {
    const { takeCall } = await freshProvider({ AI_MAX_CALLS_PER_MIN: "100", AI_MAX_CALLS_PER_DAY: "3" });
    const day = Date.UTC(2026, 8, 30, 8, 0, 0);
    const minute = 61_000;
    expect([0, 1, 2, 3, 4].map((i) => takeCall("chat", day + i * minute))).toEqual([true, true, true, false, false]);
    expect(takeCall("chat", Date.UTC(2026, 9, 1, 0, 0, 1))).toBe(true);
  });

  it("has no daily limit by default", async () => {
    const { takeCall } = await freshProvider({ AI_MAX_CALLS_PER_MIN: "1" });
    const day = Date.UTC(2026, 8, 30, 8, 0, 0);
    expect(Array.from({ length: 50 }, (_, i) => takeCall("chat", day + i * 61_000)).every(Boolean)).toBe(true);
  });
});
