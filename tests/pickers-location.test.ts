import { afterEach, describe, expect, it, vi } from "vitest";
import type { Seat } from "@prisma/client";
import { ddsTx, type Op112World } from "./fake-picker";

// Which card comes next when the lesson has a location, and when the same ticket is already in play
// at a place of the other role (a ДДС card that repeats the 112 call, or the other way round).
const world = vi.hoisted(() => ({ current: { pool: [] } as Op112World }));

vi.mock("@/lib/db", async () => ({ db: (await import("./fake-picker")).op112Db(() => world.current) }));

const { pickScenario } = await import("@/lib/flow/dds-flow");
const { nextScenario } = await import("@/lib/op112/seat");
const { lessonSettingsSchema } = await import("@/lib/lessons/settings");

const at = (street: string, district: string, okrug: string) => ({ address: { subject: "Москва", street, district, okrug } });
const S = (id: string, truth: unknown, difficulty = 3) => ({ id, difficulty, truth, ddsCard: {} });
const pool = [
  S("shchukino", at("улица Рогова", "Щукино", "СЗАО")),
  S("mitino", at("Митинская улица", "Митино", "СЗАО")),
  S("arbat", at("улица Арбат", "Арбат", "ЦАО")),
];

afterEach(() => {
  vi.restoreAllMocks();
  world.current = { pool: [] };
});

describe("ДДС place", () => {
  // A city service: the territory of a district ДДС does not narrow the choice here (see pickers-territory.test.ts).
  const own = { id: 1, shortName: "Служба 101", okrug: null, district: null };
  const seat = (scenarioIds: string[] = []) => ({ id: "seat", lessonId: "l1", studentId: "u1", serviceId: 1, scenarioIds }) as unknown as Seat;
  const tx = (opts: { busy112?: string[]; ringing?: string[]; feed?: string[] } = {}) =>
    ddsTx({ pool, own, typed112: opts.busy112, ringing: opts.ringing, feed: (opts.feed ?? []).map((scenarioId) => ({ scenarioId })) });
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

  it("in a lesson of generated cards still deals when every choice is busy at 112", async () => {
    const szao = settings({ location: { okrug: "СЗАО" } });
    expect(await pickScenario(tx({ busy112: ["shchukino"], ringing: ["mitino"] }), seat(), szao, true)).not.toBeNull();
  });

  it("never deals the same scenario twice in a lesson: when everything has come, nothing comes", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const szao = settings({ location: { okrug: "СЗАО" } });
    for (const adaptive of [true, false]) {
      expect((await pickScenario(tx({ busy112: ["shchukino"], feed: ["mitino"] }), seat(), szao, adaptive))?.id).toBe("shchukino");
      expect(await pickScenario(tx({ feed: ["mitino", "shchukino"] }), seat(), szao, adaptive)).toBeNull();
    }
    const arbat = settings({ location: { okrug: "ЦАО" } });
    expect(await pickScenario(tx({ feed: ["arbat"] }), seat(), arbat, true)).toBeNull();
  });

  it("keeps the teacher's order of tasks even when a 112 place has the same one; each task once", async () => {
    expect((await pickScenario(tx({ busy112: ["arbat"] }), seat(["arbat", "mitino"]), settings(), false))?.id).toBe("arbat");
    expect((await pickScenario(tx({ feed: ["arbat"] }), seat(["arbat", "mitino"]), settings(), false))?.id).toBe("mitino");
    expect(await pickScenario(tx({ feed: ["arbat", "mitino"] }), seat(["arbat", "mitino"]), settings(), false)).toBeNull();
  });
});

describe("112 place", () => {
  const seat = (settings: Record<string, unknown>, scenarioIds: string[] = []) =>
    ({ id: "seat", lessonId: "l1", studentId: "u1", role: "OP112", scenarioIds, lesson: { id: "l1", settings } }) as never;

  it("rings only with scenarios of the lesson's location", async () => {
    world.current = { pool };
    expect((await nextScenario(seat({ adaptive: false, location: { okrug: "ЦАО" } })))?.id).toBe("arbat");
    expect(await nextScenario(seat({ adaptive: false, location: { okrug: "ЮАО" } }))).toBeNull();
    expect((await nextScenario(seat({ adaptive: false, location: { okrug: "ЮАО" } }, ["mitino"])))?.id).toBe("mitino");
  });

  it("does not ring with a situation open in a ДДС feed of the lesson while there is another", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    world.current = { pool: pool.slice(0, 2), openInDds: ["shchukino"] };
    expect((await nextScenario(seat({ adaptive: false })))?.id).toBe("mitino");
    expect((await nextScenario(seat({})))?.id).toBe("mitino");
    world.current = { pool: pool.slice(0, 2), openInDds: ["shchukino", "mitino"] };
    expect(await nextScenario(seat({ adaptive: false }))).not.toBeNull();
    // «mitino» has rung here: «shchukino» comes, even though it is open at a ДДС; after it — nothing.
    world.current = { pool: pool.slice(0, 2), openInDds: ["shchukino"], rang: ["mitino"] };
    expect((await nextScenario(seat({})))?.id).toBe("shchukino");
    world.current = { pool: pool.slice(0, 2), rang: ["mitino", "shchukino"] };
    expect(await nextScenario(seat({}))).toBeNull();
  });
});
