import { afterEach, describe, expect, it, vi } from "vitest";
import type { Seat } from "@prisma/client";
import { ddsTx, type Op112World } from "./fake-picker";

// A ticket and its variant with an error in the card («Б4-1» / «Б4-1-ош», data/scenarios-card-errors.json) show the
// same ДДС card and are the same call: a place drawing by itself gets only one of the two in a lesson.
const world = vi.hoisted(() => ({ current: { pool: [] } as Op112World }));

vi.mock("@/lib/db", async () => ({ db: (await import("./fake-picker")).op112Db(() => world.current) }));

const { pickScenario } = await import("@/lib/flow/dds-flow");
const { nextScenario } = await import("@/lib/op112/seat");
const { lessonSettingsSchema } = await import("@/lib/lessons/settings");

const S = (id: string, ticketRef: string) => ({ id, ticketRef, difficulty: 5, truth: {}, ddsCard: { services: [] } });
const pool = [S("b41", "Б4-1"), S("b41err", "Б4-1-ош"), S("b51", "Б5-1")];
const settings = lessonSettingsSchema.parse({});

afterEach(() => {
  vi.restoreAllMocks();
  world.current = { pool: [] };
});

describe("ДДС place: a ticket and its variant with an error in the card", () => {
  const seat = (scenarioIds: string[] = []) => ({ id: "seat", lessonId: "l1", studentId: "u1", serviceId: 191, scenarioIds }) as unknown as Seat;
  const card = (scenarioId: string) => ({ scenarioId });

  it("after one of the pair — dealt to the place or saved at a 112 place — the other never comes", async () => {
    for (const adaptive of [true, false]) {
      for (const r of [0, 0.5, 0.99]) {
        vi.spyOn(Math, "random").mockReturnValue(r);
        expect((await pickScenario(ddsTx({ pool, feed: [card("b41")] }), seat(), settings, adaptive))?.id).toBe("b51");
        expect((await pickScenario(ddsTx({ pool, feed: [card("b41err")] }), seat(), settings, adaptive))?.id).toBe("b51");
        // Later in the lesson too: once the place has had both situations, nothing comes — not the other half, not a repeat.
        expect(await pickScenario(ddsTx({ pool, feed: [card("b41err"), card("b51")] }), seat(), settings, adaptive)).toBeNull();
      }
    }
  });

  it("when nothing else is left, nothing comes: neither the same ticket again nor its variant", async () => {
    const list = pool.slice(0, 2);
    for (const adaptive of [true, false]) {
      expect(await pickScenario(ddsTx({ pool: list, feed: [card("b41")] }), seat(), settings, adaptive)).toBeNull();
    }
  });

  it("skips the variant of the ticket a 112 place of the lesson is talking through", async () => {
    for (const r of [0, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      expect((await pickScenario(ddsTx({ pool, typed112: ["b41"] }), seat(), settings, false))?.id).toBe("b51");
    }
  });

  it("keeps both when the teacher assigned both to the place, each once", async () => {
    expect((await pickScenario(ddsTx({ pool, feed: [card("b41")] }), seat(["b41", "b41err"]), settings, true))?.id).toBe("b41err");
    expect(await pickScenario(ddsTx({ pool, feed: [card("b41"), card("b41err")] }), seat(["b41", "b41err"]), settings, true)).toBeNull();
  });
});

describe("112 place: a ticket and its variant are the same call", () => {
  const seat = (settings: Record<string, unknown>, scenarioIds: string[] = []) =>
    ({ id: "seat", lessonId: "l1", studentId: "u1", role: "OP112", scenarioIds, lesson: { id: "l1", settings } }) as never;

  it("does not ring with the other half of a pair the place has had", async () => {
    for (const r of [0, 0.5, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      world.current = { pool, typed: ["b41"] };
      expect((await nextScenario(seat({})))?.id).toBe("b51");
      expect((await nextScenario(seat({ adaptive: false })))?.id).toBe("b51");
      world.current = { pool, typed: ["b41err"] };
      expect((await nextScenario(seat({})))?.id).toBe("b51");
    }
  });

  it("does not ring with the ticket whose variant is open in a ДДС feed of the lesson", async () => {
    world.current = { pool, openInDds: ["b41err"] };
    expect((await nextScenario(seat({ adaptive: false })))?.id).toBe("b51");
  });

  it("never rings with a variant with an error in the card: the error lives in the card of the ДДС place only", async () => {
    const cardError = { what: "подъезд", inCard: "под. 3", onSite: "подъезд 5", report: "в карточке третий подъезд, а дымит в пятом", mustSay: [] };
    const variant = { ...S("b41err", "Б4-1-ош"), difficulty: 1, ddsReference: { services: [], cardError } };
    world.current = { pool: [variant, S("b41", "Б4-1")] };
    for (const adaptive of [true, false]) {
      for (const r of [0, 0.5, 0.99]) {
        vi.spyOn(Math, "random").mockReturnValue(r);
        expect((await nextScenario(seat({ adaptive })))?.id).toBe("b41");
      }
    }
    // Not even as a task the teacher marked for the place; a ДДС place still gets it.
    expect(await nextScenario(seat({}, ["b41err"]))).toBeNull();
    const dds = { id: "seat", lessonId: "l1", studentId: "u1", serviceId: 191, scenarioIds: ["b41err"] } as unknown as Seat;
    expect((await pickScenario(ddsTx({ pool: world.current.pool }), dds, settings, false))?.id).toBe("b41err");
  });
});
