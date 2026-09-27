import { describe, expect, it } from "vitest";
import { lastOccurrence } from "./days";
import { demoResetDue } from "./scheduler";

describe("scheduler: nightly demo reset window", () => {
  const at = (h: number, m = 0) => new Date(2026, 8, 27, h, m);

  it("is due only in the window after the reset time, never in the middle of the day", () => {
    expect(demoResetDue(at(4, 30), "04:30").due).toBe(true);
    expect(demoResetDue(at(7, 29), "04:30").due).toBe(true);
    expect(demoResetDue(at(7, 30), "04:30").due).toBe(false);
    expect(demoResetDue(at(15, 0), "04:30").due).toBe(false);
    expect(demoResetDue(at(4, 29), "04:30").due).toBe(false);
  });

  it("keeps one window across midnight", () => {
    const late = demoResetDue(at(0, 30), "23:30");
    expect(late.due).toBe(true);
    expect(late.start.getTime()).toBe(lastOccurrence(at(0, 30), "23:30").getTime());
    expect(late.start.getDate()).toBe(26);
  });
});
