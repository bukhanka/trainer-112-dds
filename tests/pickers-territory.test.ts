import { afterEach, describe, expect, it, vi } from "vitest";
import type { Seat } from "@prisma/client";
import { ddsTx, type DdsWorld, type Op112World } from "./fake-picker";

// What a place gets next after the jury check of 28.09: a district ДДС gets cards of its territory, nothing comes to a
// place twice in a lesson, and in a lesson of mixed cards a situation of a 112 place is not generated for a ДДС place.
const world = vi.hoisted(() => ({ current: { pool: [] } as Op112World }));

vi.mock("@/lib/db", async () => ({ db: (await import("./fake-picker")).op112Db(() => world.current) }));

const { drawCard, pickScenario } = await import("@/lib/flow/dds-flow");
const { drawCall } = await import("@/lib/op112/seat");
const { lessonSettingsSchema } = await import("@/lib/lessons/settings");

const address = (okrug: string, district: string, street: string, house?: string) => ({ subject: "Москва", city: "Москва", okrug, district, street, ...(house ? { house } : {}) });
const S = (id: string, addr: Record<string, string>, description: string, extra: Record<string, unknown> = {}) => ({
  id,
  ticketRef: null,
  difficulty: 3,
  truth: { address: addr },
  ddsCard: { description },
  ...extra,
});
// Хорошёво-Мнёвники: its own house; a house in the centre that can move; a station and the region that cannot.
const own = S("own", address("СЗАО", "Хорошёво-Мнёвники", "ул. Берзарина", "21"), "Задымление мусоропровода в жилом доме");
const alarm = S("alarm", address("ЦАО", "Мещанский", "Большой Сухаревский пер.", "19"), "В жилом доме сработала пожарная сигнализация");
const station = S("station", address("ЦАО", "Красносельский", "Комсомольская пл.", "5"), "На Ярославском вокзале нет одного крепления на табло");
const region = S("region", { subject: "Московская область", city: "Королёв", street: "ул. Станционная", house: "28" }, "Горит крыша частного дома");
const pool = [own, alarm, station, region];

const horoshevo = { id: 87, shortName: "Поселение Хорошево-Мневники", okrug: "СЗАО", district: "Хорошево-Мневники" };
const service101 = { id: 1, shortName: "Служба 101", okrug: null, district: null };
const seat = (serviceId: number, scenarioIds: string[] = []) => ({ id: "seat", lessonId: "l1", studentId: "u1", serviceId, scenarioIds }) as unknown as Seat;
const settings = (patch: Record<string, unknown> = {}) => lessonSettingsSchema.parse(patch);
const tx = (w: Partial<DdsWorld> & { feed?: string[] } = {}) => ddsTx({ pool, own: horoshevo, ...w, feed: (w.feed ?? []).map((scenarioId) => ({ scenarioId })) });

afterEach(() => {
  vi.restoreAllMocks();
  world.current = { pool: [] };
});

describe("a district ДДС gets the cards of its territory", () => {
  it("first the situations of its district, then those whose house can move there; never a station or another region", async () => {
    for (const adaptive of [true, false]) {
      for (const r of [0, 0.5, 0.99]) {
        vi.spyOn(Math, "random").mockReturnValue(r);
        expect((await pickScenario(tx(), seat(87), settings(), adaptive))?.id).toBe("own");
        expect((await pickScenario(tx({ feed: ["own"] }), seat(87), settings(), adaptive))?.id).toBe("alarm");
        expect(await pickScenario(tx({ feed: ["own", "alarm"] }), seat(87), settings(), adaptive)).toBeNull();
      }
    }
  });

  it("counts what is left, so the place and the board learn with the last card that the tasks are over", async () => {
    const first = await drawCard(tx(), seat(87), settings(), false);
    expect([first.scenario?.id, first.pool, first.left]).toEqual(["own", 2, 1]);
    const last = await drawCard(tx({ feed: ["own"] }), seat(87), settings(), false);
    expect([last.scenario?.id, last.left]).toEqual(["alarm", 0]);
    const none = await drawCard(tx({ feed: ["own", "alarm"] }), seat(87), settings(), false);
    expect([none.scenario, none.pool, none.left]).toEqual([null, 2, 0]);
  });

  it("deals a task marked by hand as it is, even off the territory (it is judged as a refusal)", async () => {
    expect((await pickScenario(tx(), seat(87, ["station"]), settings(), true))?.id).toBe("station");
    expect(await pickScenario(tx({ feed: ["station"] }), seat(87, ["station"]), settings(), true)).toBeNull();
  });
});

describe("nothing comes to a place twice in a lesson", () => {
  it("«Служба 101» with one task gets it once, not four times", async () => {
    const w = { pool: [alarm], own: service101 };
    expect((await pickScenario(ddsTx(w), seat(1, ["alarm"]), settings(), true))?.id).toBe("alarm");
    for (let i = 0; i < 4; i++) expect(await pickScenario(ddsTx({ ...w, feed: [{ scenarioId: "alarm" }] }), seat(1, ["alarm"]), settings(), true)).toBeNull();
    // A card of the same scenario that came from a 112 place counts too.
    expect(await pickScenario(ddsTx({ pool: [alarm, own], own: service101, feed: [{ scenarioId: "alarm" }, { scenarioId: "own" }] }), seat(1), settings(), false)).toBeNull();
  });

  it("the 112 place gets each call once: a missed or declined call counts, the repeat call waits for its first card", async () => {
    const s = (id: string, truth: Record<string, unknown> = {}) => ({ id, ticketRef: null, difficulty: 3, truth, ddsCard: null, ddsReference: null });
    const op = (scenarioIds: string[] = []) => ({ id: "seat", lessonId: "l1", studentId: "u1", role: "OP112", scenarioIds, lesson: { id: "l1", settings: {} } }) as never;
    world.current = { pool: [s("fight"), s("fire")], rang: ["fight"] };
    expect((await drawCall(op(["fight", "fire"]))).scenario?.id).toBe("fire");
    world.current = { pool: [s("fight"), s("fire")], rang: ["fight", "fire"] };
    expect(await drawCall(op(["fight", "fire"]))).toEqual({ scenario: null, pool: 2, left: 0 });
    // A repeat call about a card not saved yet: nothing rings now, but the task is still to come.
    world.current = { pool: [s("again", { repeatOf: "Б4-1" })] };
    expect(await drawCall(op(["again"]))).toEqual({ scenario: null, pool: 1, left: 1 });
  });
});

describe("a lesson of mixed cards", () => {
  const mixed = settings({ cardSource: "mixed" });

  it("never generates for a ДДС place a situation that is ringing, typed or planned at a 112 place", async () => {
    for (const busy of [{ ringing: ["own"] }, { typed112: ["own"] }, { tasks112: ["own"] }]) {
      expect((await pickScenario(tx(busy), seat(87), mixed, false))?.id).toBe("alarm");
      // Not even a task of the ДДС place: it comes from the 112 place.
      expect(await pickScenario(tx(busy), seat(87, ["own"]), mixed, false)).toBeNull();
    }
    const all = await drawCard(tx({ ringing: ["own"], typed112: ["alarm"] }), seat(87), mixed, false);
    expect([all.scenario, all.pool > 0]).toEqual([null, true]); // the tasks are over, not «no scenarios»
  });

  it("in a lesson of generated cards a situation busy at 112 only waits while there is another", async () => {
    expect((await pickScenario(tx({ typed112: ["own"] }), seat(87), settings(), false))?.id).toBe("alarm");
    expect((await pickScenario(tx({ typed112: ["own"], feed: ["alarm"] }), seat(87), settings(), false))?.id).toBe("own");
  });

  it("a 112 place drawing by itself does not ring with a situation a ДДС place has got as a generated card", async () => {
    const s = (id: string) => ({ id, ticketRef: null, difficulty: 3, truth: {}, ddsCard: null, ddsReference: null });
    const op = (scenarioIds: string[] = []) =>
      ({ id: "seat", lessonId: "l1", studentId: "u1", role: "OP112", scenarioIds, lesson: { id: "l1", settings: { cardSource: "mixed", adaptive: false } } }) as never;
    world.current = { pool: [s("fight"), s("fire")], dealtInDds: ["fight"] };
    expect((await drawCall(op())).scenario?.id).toBe("fire");
    world.current = { pool: [s("fight"), s("fire")], dealtInDds: ["fight", "fire"] };
    expect((await drawCall(op())).scenario).toBeNull();
    // A task the teacher marked rings anyway.
    expect((await drawCall(op(["fight"]))).scenario?.id).toBe("fight");
  });
});
