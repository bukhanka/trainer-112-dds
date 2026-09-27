import { describe, expect, it } from "vitest";
import { lastDays, moscowDay, moscowDayStart } from "./days";
import { fillDays, sumDays } from "./stats";

describe("Moscow days", () => {
  it("turns a moment into the Moscow calendar day", () => {
    expect(moscowDay(Date.parse("2026-09-26T20:59:59Z"))).toBe("2026-09-26");
    expect(moscowDay(Date.parse("2026-09-26T21:00:00Z"))).toBe("2026-09-27");
    expect(moscowDayStart("2026-09-27").toISOString()).toBe("2026-09-26T21:00:00.000Z");
  });

  it("lists the last days oldest first, ending with today", () => {
    expect(lastDays(3, Date.parse("2026-10-01T22:30:00Z"))).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
  });
});

describe("usage statistics", () => {
  it("puts every day on the calendar, missing ones as zero, and sums the period", () => {
    const days = fillDays(["2026-09-26", "2026-09-27"], { logins: [{ day: "2026-09-27", n: 4 }], attempts: [{ day: "2026-09-26", n: 2 }] });
    expect(days.map((d) => [d.logins, d.attempts, d.aiCalls])).toEqual([
      [0, 2, 0],
      [4, 0, 0],
    ]);
    expect(sumDays(days)).toMatchObject({ logins: 4, attempts: 2, confirmed: 0 });
  });
});
