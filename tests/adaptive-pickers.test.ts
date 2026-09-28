import { afterEach, describe, expect, it, vi } from "vitest";
import type { Seat } from "@prisma/client";
import { ddsTx, type Op112World } from "./fake-picker";

// The next task of a place: manual lists and «одна карточка на всех» as before, adaptive choice otherwise.
const world = vi.hoisted(() => ({ current: { pool: [] } as Op112World }));

vi.mock("@/lib/db", async () => ({ db: (await import("./fake-picker")).op112Db(() => world.current) }));

const { pickScenario } = await import("@/lib/flow/dds-flow");
const { nextScenario } = await import("@/lib/op112/seat");
const { lessonSettingsSchema } = await import("@/lib/lessons/settings");

const s = (id: string, difficulty: number) => ({ id, difficulty, ddsCard: {} });
/** A strong student: many perfect attempts on the hardest tasks. */
const strong = (kind: "DDS" | "OP112") =>
  Array.from({ length: 30 }, (_, i) => ({ id: `a${i}`, studentId: "u1", lessonId: "l0", kind, score: 100, reviewStatus: "CONFIRMED", createdAt: new Date(Date.UTC(2026, 8, 1, 7, i)), reviewedAt: null, scenario: { difficulty: 10 } }));

afterEach(() => {
  vi.restoreAllMocks();
  world.current = { pool: [] };
});

describe("ДДС place: which card comes next", () => {
  const seat = (scenarioIds: string[] = []) => ({ id: "seat", lessonId: "l1", studentId: "u1", serviceId: 3, scenarioIds }) as unknown as Seat;
  const settings = lessonSettingsSchema.parse({});
  // The place's service is unknown here: the plate preference steps aside.
  const tx = (pool: ReturnType<typeof s>[], feed: string[] = [], attempts: Record<string, unknown>[] = []) =>
    ddsTx({ pool, feed: feed.map((scenarioId) => ({ scenarioId })), attempts });

  it("keeps the teacher's order of assigned tasks, adaptive or not", async () => {
    const pool = [s("a", 3), s("b", 9)];
    expect((await pickScenario(tx(pool), seat(["b", "a"]), settings, true))?.id).toBe("b");
    expect((await pickScenario(tx(pool, ["b"]), seat(["b", "a"]), settings, true))?.id).toBe("a");
  });

  it("deals a card near the level when adaptive, at random when not (or one card for all)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);
    const pool = [s("easy", 3), s("hard1", 9), s("hard2", 9)];
    // A newcomer's level recommends difficulty 3.
    expect((await pickScenario(tx(pool), seat(), settings, true))?.id).toBe("easy");
    // The old way: a random fresh card.
    expect((await pickScenario(tx(pool), seat(), settings, false))?.id).toBe("hard2");
  });

  it("takes first the situations that would reach the place's service in real work", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const names = new Map([
      [3, "Служба 103"],
      [1, "Служба 101"],
      [60, "Поселение Щукино"],
    ]);
    const card = (ids: number[]) => ({ services: ids });
    const pool = [
      { ...s("only101", 5), ddsCard: card([1, 60]) },
      { ...s("with103", 5), ddsCard: card([1, 3]) },
    ];
    const own = { id: 3, shortName: "Служба 103", okrug: null, district: null };
    expect((await pickScenario(ddsTx({ pool, own, names }), seat(), settings, false))?.id).toBe("with103");
    expect((await pickScenario(ddsTx({ pool, own, names }), seat(), settings, true))?.id).toBe("with103");
  });

  it("prefers the situations whose reference judges the place over those that only reach it", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.1);
    const names = new Map([
      [1, "Служба 101"],
      [3, "Служба 103"],
    ]);
    const card = (ids: number[]) => ({ services: ids });
    const pool = [
      { ...s("reachesOnly", 5), ddsCard: card([1, 3]), ddsReference: { services: [{ serviceId: 1, service: "Служба 101", decision: "ACCEPTED", chain: ["ACCEPTED", "FINISHED"] }] } },
      { ...s("judged", 5), ddsCard: card([1, 3]), ddsReference: { services: [{ serviceId: 3, service: "Служба 103", decision: "ACCEPTED", chain: ["ACCEPTED", "FINISHED"] }] } },
    ];
    const own = { id: 3, shortName: "Служба 103", okrug: null, district: null };
    expect((await pickScenario(ddsTx({ pool, own, names }), seat(), settings, false))?.id).toBe("judged");
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

  it("keeps the teacher's order of assigned tasks, with adaptive on; each once", async () => {
    world.current = { pool: [s("a", 2), s("b", 7)] };
    expect((await nextScenario(seat({}, ["b", "a"])))?.id).toBe("b");
    world.current = { pool: [s("a", 2), s("b", 7)], rang: ["b"] };
    expect((await nextScenario(seat({}, ["b", "a"])))?.id).toBe("a");
    world.current = { pool: [s("a", 2), s("b", 7)], rang: ["b", "a"] };
    expect(await nextScenario(seat({}, ["b", "a"]))).toBeNull();
  });

  it("deals near the level when adaptive, easiest first when off or in «одна карточка на всех»", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    world.current = { pool: [s("d1", 1), s("d3", 3), s("d9", 9)] };
    expect((await nextScenario(seat({})))?.id).toBe("d3");
    expect((await nextScenario(seat({ adaptive: false })))?.id).toBe("d1");
    expect((await nextScenario(seat({ sameCard: true })))?.id).toBe("d1");
  });

  it("follows the student's 112 level, not the ДДС one", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    world.current = { pool: [s("d3", 3), s("d9", 9)], attempts: strong("DDS") };
    expect((await nextScenario(seat({})))?.id).toBe("d3");
    world.current = { pool: [s("d3", 3), s("d9", 9)], attempts: strong("OP112") };
    expect((await nextScenario(seat({})))?.id).toBe("d9");
  });
});
