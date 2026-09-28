import { afterEach, describe, expect, it, vi } from "vitest";
import type { Seat } from "@prisma/client";

// A ticket and its variant with an error in the card («Б4-1» / «Б4-1-ош», data/scenarios-card-errors.json) show the
// same ДДС card and are the same call: a place drawing by itself gets only one of the two in a lesson.
const store = vi.hoisted(() => ({
  pool: [] as { id: string; ticketRef: string | null; difficulty: number; truth: unknown; ddsCard: unknown }[],
  openInDds: [] as { scenarioId: string }[],
  used: [] as { scenarioId: string; _max: { createdAt: Date } }[],
}));

/** Tasks marked by hand and the tickets of the scenarios a place had are asked by id; the drawing pool by status. */
const byIds = <T extends { id: string }>(rows: T[], where: { id?: { in?: string[] } }) => (where.id?.in ? rows.filter((r) => where.id!.in!.includes(r.id)) : rows);

vi.mock("@/lib/db", () => ({
  db: {
    scenario: { findMany: async ({ where }: { where: { id?: { in?: string[] } } }) => byIds(store.pool, where) },
    incident: { groupBy: async () => store.used, findMany: async () => store.openInDds },
    attempt: { findMany: async () => [] },
  },
}));

const { pickScenario } = await import("@/lib/flow/dds-flow");
const { nextScenario } = await import("@/lib/op112/seat");
const { lessonSettingsSchema } = await import("@/lib/lessons/settings");

const S = (id: string, ticketRef: string) => ({ id, ticketRef, difficulty: 5, truth: {}, ddsCard: { services: [] } });
const pool = [S("b41", "Б4-1"), S("b41err", "Б4-1-ош"), S("b51", "Б5-1")];
const settings = lessonSettingsSchema.parse({});

afterEach(() => {
  vi.restoreAllMocks();
  store.pool = [];
  store.openInDds = [];
  store.used = [];
});

describe("ДДС place: a ticket and its variant with an error in the card", () => {
  const seat = (scenarioIds: string[] = []) => ({ id: "seat", lessonId: "l1", studentId: "u1", serviceId: 191, scenarioIds }) as unknown as Seat;
  type Card = { scenarioId: string; createdAt: Date; scenario: { ticketRef: string } };
  const card = (id: string): Card => ({ scenarioId: id, createdAt: new Date(), scenario: { ticketRef: pool.find((s) => s.id === id)!.ticketRef } });
  /** incident.findMany answers the feed query and the «busy at 112» query differently. */
  const tx = (opts: { list?: typeof pool; feed?: Card[]; busy112?: string[] } = {}) =>
    ({
      scenario: { findMany: async ({ where }: { where: { id?: { in?: string[] } } }) => byIds(opts.list ?? pool, where) },
      incident: {
        findMany: async ({ where }: { where: { source?: string } }) =>
          where.source === "op112" ? (opts.busy112 ?? []).map((scenarioId) => ({ scenarioId })) : (opts.feed ?? []),
      },
      call: { findMany: async () => [] },
      attempt: { findMany: async () => [] },
      service: { findUnique: async () => null, findMany: async () => [] },
    }) as never;

  it("after one of the pair — dealt to the place or saved at a 112 place — the other never comes while there is another", async () => {
    for (const adaptive of [true, false]) {
      for (const r of [0, 0.5, 0.99]) {
        vi.spyOn(Math, "random").mockReturnValue(r);
        expect((await pickScenario(tx({ feed: [card("b41")] }), seat(), settings, adaptive))?.id).toBe("b51");
        expect((await pickScenario(tx({ feed: [card("b41err")] }), seat(), settings, adaptive))?.id).toBe("b51");
        // Not only right after it: later in the lesson too — the variant seen earlier comes again rather than its ticket.
        const later = [card("b41err"), { ...card("b51"), createdAt: new Date(Date.now() + 60_000) }];
        expect((await pickScenario(tx({ feed: later }), seat(), settings, adaptive))?.id).toBe("b41err");
      }
    }
  });

  it("when nothing else is left, the same ticket comes again, not its variant", async () => {
    const list = pool.slice(0, 2);
    for (const adaptive of [true, false]) {
      for (const r of [0, 0.99]) {
        vi.spyOn(Math, "random").mockReturnValue(r);
        expect((await pickScenario(tx({ list, feed: [card("b41")] }), seat(), settings, adaptive))?.id).toBe("b41");
      }
    }
  });

  it("skips the variant of the ticket a 112 place of the lesson is talking through", async () => {
    for (const r of [0, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      expect((await pickScenario(tx({ busy112: ["b41"] }), seat(), settings, false))?.id).toBe("b51");
    }
  });

  it("keeps both when the teacher assigned both to the place", async () => {
    expect((await pickScenario(tx({ feed: [card("b41")] }), seat(["b41", "b41err"]), settings, true))?.id).toBe("b41err");
  });
});

describe("112 place: a ticket and its variant are the same call", () => {
  const seat = (settings: Record<string, unknown>, scenarioIds: string[] = []) =>
    ({ id: "seat", lessonId: "l1", studentId: "u1", role: "OP112", scenarioIds, lesson: { id: "l1", settings } }) as never;

  it("does not ring with the other half of a pair the place has had", async () => {
    store.pool = pool;
    for (const r of [0, 0.5, 0.99]) {
      vi.spyOn(Math, "random").mockReturnValue(r);
      store.used = [{ scenarioId: "b41", _max: { createdAt: new Date() } }];
      expect((await nextScenario(seat({})))?.id).toBe("b51");
      expect((await nextScenario(seat({ adaptive: false })))?.id).toBe("b51");
      store.used = [{ scenarioId: "b41err", _max: { createdAt: new Date() } }];
      expect((await nextScenario(seat({})))?.id).toBe("b51");
    }
  });

  it("does not ring with the ticket whose variant is open in a ДДС feed of the lesson", async () => {
    store.pool = pool;
    store.openInDds = [{ scenarioId: "b41err" }];
    expect((await nextScenario(seat({ adaptive: false })))?.id).toBe("b51");
  });
});
