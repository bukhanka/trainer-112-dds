import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/dds/review", () => ({ finishLessonEvaluation: async () => 0 }));

const { abandonedPractice, practiceSession, PRACTICE_IDLE_MIN } = await import("./practice-cleanup");

const now = new Date("2026-09-27T12:00:00Z").getTime();
const minAgo = (m: number) => new Date(now - m * 60_000);
const lesson = (id: string, settings: object, startedMinAgo = 5) => ({ id, settings, startedAt: minAgo(startedMinAgo), createdAt: minAgo(startedMinAgo) });

describe("abandoned practice is finished by itself", () => {
  it("a 112 practice whose login session is over (logout, expiry) closes at once", () => {
    const l = lesson("p112", { practice: true, selfTraining: true, sessionId: "s1" });
    expect(practiceSession(l.settings)).toBe("s1");
    expect(abandonedPractice([l], new Set(["s1"]), new Map(), now)).toEqual([]);
    expect(abandonedPractice([l], new Set(), new Map(), now)).toEqual(["p112"]);
  });

  it(`any practice with nothing happening for ${PRACTICE_IDLE_MIN} minutes closes; recent activity keeps it`, () => {
    const dds = lesson("pdds", { practice: true, practiceKey: "k" }, 300);
    expect(abandonedPractice([dds], new Set(), new Map([["pdds", minAgo(PRACTICE_IDLE_MIN + 1).getTime()]]), now)).toEqual(["pdds"]);
    expect(abandonedPractice([dds], new Set(), new Map([["pdds", minAgo(10).getTime()]]), now)).toEqual([]);
    // Just started, nothing done yet: not idle.
    expect(abandonedPractice([lesson("fresh", { practice: true }, 3)], new Set(), new Map(), now)).toEqual([]);
  });

  it("a teacher's lesson is never closed by this rule", () => {
    expect(abandonedPractice([lesson("class", { cardSource: "students" }, 600)], new Set(), new Map(), now)).toEqual([]);
  });
});
