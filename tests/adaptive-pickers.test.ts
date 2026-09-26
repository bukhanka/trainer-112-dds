import { afterEach, describe, expect, it, vi } from "vitest";
import type { Seat } from "@prisma/client";

// The next task of a place: manual lists and «одна карточка на всех» as before, adaptive choice otherwise.
const store = vi.hoisted(() => ({
  pool: [] as { id: string; difficulty: number }[],
  used: [] as { scenarioId: string; _max: { createdAt: Date } }[],
  attempts: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    scenario: { findMany: async () => store.pool },
    incident: { groupBy: async () => store.used, findMany: async () => [] },
    attempt: { findMany: async () => store.attempts },
  },
}));

const { pickScenario } = await import("@/lib/flow/dds-flow");
const { nextScenario } = await import("@/lib/op112/seat");
const { lessonSettingsSchema } = await import("@/lib/lessons/settings");

const s = (id: string, difficulty: number) => ({ id, difficulty });
/** A strong student: many perfect attempts on the hardest tasks. */
const strong = (kind: "DDS" | "OP112") =>
  Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, studentId: "u1", lessonId: "l0", kind, score: 100, reviewStatus: "CONFIRMED", createdAt: new Date(Date.UTC(2026, 8, 1, 7, i)), reviewedAt: null, scenario: { difficulty: 10 } }));

afterEach(() => {
  vi.restoreAllMocks();
  store.pool = [];
  store.used = [];
  store.attempts = [];
});

describe("ДДС place: which card comes next", () => {
  const seat = (scenarioIds: string[] = []) => ({ id: "seat", lessonId: "l1", studentId: "u1", serviceId: 191, scenarioIds }) as unknown as Seat;
  const settings = lessonSettingsSchema.parse({});
  const tx = (pool: { id: string; difficulty: number }[], feed: { scenarioId: string; createdAt: Date }[] = [], attempts: Record<string, unknown>[] = []) =>
    ({
      scenario: { findMany: async () => pool },
      incident: { findMany: async () => feed },
      attempt: { findMany: async () => attempts },
    }) as never;

  it("keeps the teacher's order of assigned tasks, adaptive or not", async () => {
    const pool = [s("a", 3), s("b", 9)];
    expect((await pickScenario(tx(pool), seat(["b", "a"]), settings, true))?.id).toBe("b");
    expect((await pickScenario(tx(pool, [{ scenarioId: "b", createdAt: new Date() }]), seat(["b", "a"]), settings, true))?.id).toBe("a");
  });

  it("deals a card near the level when adaptive, at random when not (or one card for all)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const pool = [s("easy", 3), s("hard1", 9), s("hard2", 9)];
    // A newcomer's level recommends difficulty 3.
    expect((await pickScenario(tx(pool), seat(), settings, true))?.id).toBe("easy");
    // The old way: a random fresh card.
    expect((await pickScenario(tx(pool), seat(), settings, false))?.id).toBe("hard2");
  });

  it("gives a strong student the hard card", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const pool = [s("easy", 3), s("hard", 9)];
    expect((await pickScenario(tx(pool, [], strong("DDS")), seat(), settings, true))?.id).toBe("hard");
  });
});

describe("112 place: which call comes next", () => {
  const seat = (settings: Record<string, unknown>, scenarioIds: string[] = []) =>
    ({ id: "seat", lessonId: "l1", studentId: "u1", role: "OP112", scenarioIds, lesson: { id: "l1", settings } }) as never;

  it("keeps the easiest-first order for assigned tasks, with adaptive on", async () => {
    store.pool = [s("a", 2), s("b", 7)];
    expect((await nextScenario(seat({}, ["a", "b"])))?.id).toBe("a");
  });

  it("deals near the level when adaptive, easiest first when off or in «одна карточка на всех»", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    store.pool = [s("d1", 1), s("d3", 3), s("d9", 9)];
    expect((await nextScenario(seat({})))?.id).toBe("d3");
    expect((await nextScenario(seat({ adaptive: false })))?.id).toBe("d1");
    expect((await nextScenario(seat({ sameCard: true })))?.id).toBe("d1");
  });

  it("follows the student's 112 level, not the ДДС one", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    store.pool = [s("d3", 3), s("d9", 9)];
    store.attempts = strong("DDS");
    expect((await nextScenario(seat({})))?.id).toBe("d3");
    store.attempts = strong("OP112");
    expect((await nextScenario(seat({})))?.id).toBe("d9");
  });
});
