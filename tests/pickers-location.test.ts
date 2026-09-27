import { afterEach, describe, expect, it, vi } from "vitest";
import type { Seat } from "@prisma/client";

// Which card comes next when the lesson has a location, and when the same ticket is already in play
// at a place of the other role (a ДДС card that repeats the 112 call, or the other way round).
const store = vi.hoisted(() => ({
  pool: [] as { id: string; difficulty: number; truth: unknown }[],
  openInDds: [] as { scenarioId: string }[],
}));

/** Tasks marked by hand are asked by id; everything else by status and category, which the pool here passes. */
const byIds = <T extends { id: string }>(rows: T[], where: { id?: { in?: string[] } }) => (where.id?.in ? rows.filter((r) => where.id!.in!.includes(r.id)) : rows);

vi.mock("@/lib/db", () => ({
  db: {
    scenario: { findMany: async ({ where }: { where: { id?: { in?: string[] } } }) => byIds(store.pool, where) },
    incident: { groupBy: async () => [], findMany: async () => store.openInDds },
    attempt: { findMany: async () => [] },
  },
}));

const { pickScenario } = await import("@/lib/flow/dds-flow");
const { nextScenario } = await import("@/lib/op112/seat");
const { lessonSettingsSchema } = await import("@/lib/lessons/settings");

const at = (street: string, district: string, okrug: string) => ({ address: { subject: "Москва", street, district, okrug } });
const S = (id: string, truth: unknown, difficulty = 3) => ({ id, difficulty, truth });
const pool = [
  S("shchukino", at("улица Рогова", "Щукино", "СЗАО")),
  S("mitino", at("Митинская улица", "Митино", "СЗАО")),
  S("arbat", at("улица Арбат", "Арбат", "ЦАО")),
];

afterEach(() => {
  vi.restoreAllMocks();
  store.pool = [];
  store.openInDds = [];
});

describe("ДДС place", () => {
  const seat = (scenarioIds: string[] = []) => ({ id: "seat", lessonId: "l1", studentId: "u1", serviceId: 191, scenarioIds }) as unknown as Seat;
  /** incident.findMany answers the feed query and the «busy at 112» query differently. */
  const tx = (opts: { busy112?: string[]; ringing?: string[]; feed?: { scenarioId: string; createdAt: Date }[] } = {}) =>
    ({
      scenario: { findMany: async ({ where }: { where: { id?: { in?: string[] } } }) => byIds(pool, where) },
      incident: {
        findMany: async ({ where }: { where: { source?: string } }) =>
          where.source === "op112" ? (opts.busy112 ?? []).map((scenarioId) => ({ scenarioId })) : (opts.feed ?? []),
      },
      call: { findMany: async () => (opts.ringing ?? []).map((scenarioId) => ({ counterpart: { scenarioId, name: "Заявитель" } })) },
      attempt: { findMany: async () => [] },
      service: { findUnique: async () => null, findMany: async () => [] },
    }) as never;
  const settings = (patch: Record<string, unknown> = {}) => lessonSettingsSchema.parse(patch);

  it("draws only scenarios of the lesson's location, adaptive or not", async () => {
    for (const r of [0, 0.5, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      const okrug = settings({ location: { okrug: "СЗАО" } });
      expect(["shchukino", "mitino"]).toContain((await pickScenario(tx(), seat(), okrug, true))?.id);
      expect(["shchukino", "mitino"]).toContain((await pickScenario(tx(), seat(), okrug, false))?.id);
      const district = settings({ location: { okrug: "ЦАО", district: "Арбат" } });
      expect((await pickScenario(tx(), seat(), district, false))?.id).toBe("arbat");
    }
  });

  it("gives nothing when the location has no scenario, and ignores the location for tasks marked by hand", async () => {
    expect(await pickScenario(tx(), seat(), settings({ location: { okrug: "ЮАО" } }), true)).toBeNull();
    expect((await pickScenario(tx(), seat(["arbat"]), settings({ location: { okrug: "СЗАО" } }), true))?.id).toBe("arbat");
  });

  it("skips the ticket a 112 place of the lesson is working on — an open card or a ringing call", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const szao = settings({ location: { okrug: "СЗАО" } });
    for (const adaptive of [true, false]) {
      expect((await pickScenario(tx({ busy112: ["shchukino"] }), seat(), szao, adaptive))?.id).toBe("mitino");
      expect((await pickScenario(tx({ ringing: ["mitino"] }), seat(), szao, adaptive))?.id).toBe("shchukino");
    }
  });

  it("still deals when every choice is busy — a repeat is better than an empty feed", async () => {
    const szao = settings({ location: { okrug: "СЗАО" } });
    expect(await pickScenario(tx({ busy112: ["shchukino"], ringing: ["mitino"] }), seat(), szao, true)).not.toBeNull();
  });

  it("keeps the teacher's order of tasks even when a 112 place has the same one", async () => {
    expect((await pickScenario(tx({ busy112: ["arbat"] }), seat(["arbat", "mitino"]), settings(), false))?.id).toBe("arbat");
  });
});

describe("112 place", () => {
  const seat = (settings: Record<string, unknown>, scenarioIds: string[] = []) =>
    ({ id: "seat", lessonId: "l1", studentId: "u1", role: "OP112", scenarioIds, lesson: { id: "l1", settings } }) as never;

  it("rings only with scenarios of the lesson's location", async () => {
    store.pool = pool;
    expect((await nextScenario(seat({ adaptive: false, location: { okrug: "ЦАО" } })))?.id).toBe("arbat");
    expect(await nextScenario(seat({ adaptive: false, location: { okrug: "ЮАО" } }))).toBeNull();
    expect((await nextScenario(seat({ adaptive: false, location: { okrug: "ЮАО" } }, ["mitino"])))?.id).toBe("mitino");
  });

  it("does not ring with a situation open in a ДДС feed of the lesson while there is another", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    store.pool = pool.slice(0, 2);
    store.openInDds = [{ scenarioId: "shchukino" }];
    expect((await nextScenario(seat({ adaptive: false })))?.id).toBe("mitino");
    expect((await nextScenario(seat({})))?.id).toBe("mitino");
    store.openInDds = [{ scenarioId: "shchukino" }, { scenarioId: "mitino" }];
    expect(await nextScenario(seat({ adaptive: false }))).not.toBeNull();
  });
});
