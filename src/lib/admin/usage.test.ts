import { afterEach, describe, expect, it, vi } from "vitest";

const writes = vi.hoisted(() => [] as unknown[][]);
vi.mock("../db", () => ({
  db: { $executeRaw: async (_sql: TemplateStringsArray, ...values: unknown[]) => void writes.push(values) },
}));

const { countUsage, flushUsage } = await import("./usage");

afterEach(() => {
  vi.useRealTimers();
  writes.length = 0;
});

describe("usage counters", () => {
  it("add up in memory and reach the database at most once a minute, per Moscow day", async () => {
    vi.useFakeTimers({ now: Date.parse("2026-09-27T10:00:00Z") });
    countUsage("ai.chat");
    await vi.advanceTimersByTimeAsync(0); // the first count after a quiet period is written at once
    expect(writes).toEqual([["2026-09-27", "ai.chat", 1]]);
    for (let i = 0; i < 5; i++) countUsage("ai.chat");
    countUsage("ai.rules", 2);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(writes).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(writes.slice(1)).toEqual([
      ["2026-09-27", "ai.chat", 5],
      ["2026-09-27", "ai.rules", 2],
    ]);
  });

  it("keeps late-evening counts on the Moscow day", async () => {
    countUsage("ai.voice", 1, Date.parse("2026-09-27T21:30:00Z"));
    await flushUsage();
    expect(writes).toEqual([["2026-09-28", "ai.voice", 1]]);
  });
});
