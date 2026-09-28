import { beforeEach, describe, expect, it, vi } from "vitest";

// The end-of-lesson review of a ДДС place, also run when a student opens the place of a finished lesson
// (/api/dds/state): which plates get a review. evaluatePlate reads the plate first — here it finds nothing and
// stores nothing, so the ids it was asked for tell which plates were due.
const store = vi.hoisted(() => ({ plates: [] as unknown[], seats: [] as unknown[], reviewed: [] as string[] }));

vi.mock("@/lib/db", () => ({
  db: {
    incidentService: {
      findMany: async () => store.plates,
      findUnique: async ({ where }: { where: { id: string } }) => {
        store.reviewed.push(where.id);
        return null;
      },
    },
    call: { updateMany: async () => ({ count: 0 }), findMany: async () => [] },
    seat: { findMany: async () => store.seats },
  },
}));

const { evaluateSeatPlates, finishLessonEvaluation } = await import("./review");

function seat(cardSource: string) {
  return { id: "s2", lessonId: "l1", serviceId: 191, lesson: { settings: { cardSource } } };
}
const ev = (status: string, seatId: string | null = null) => ({ status, seatId });
const plate = (id: string, source: string, events: { status: string; seatId: string | null }[], attempts: unknown[] = []) => ({
  id,
  incident: { source },
  events,
  attempts,
});

const PLATES = [
  // A card dealt to the place that nobody opened: reviewed — «Не оповещено».
  plate("own-idle", "generated", [ev("ADDED")]),
  // Reviewed by another tool (the demo lessons): left as it is.
  plate("own-demo", "generated", [ev("ADDED", "s2"), ev("RECEIVED", "s2"), ev("ACCEPTED", "s2")], [{ reviewStatus: "CONFIRMED", aiDraft: { source: "rules" } }]),
  // A card typed at 112 that the system answered for the service (the demo lesson «Пожары и газ: первые карточки»).
  plate("112-bot", "op112", [ev("ADDED"), ev("RECEIVED"), ev("ACCEPTED"), ev("STARTED")]),
  // A card typed at 112 that the place opened: its work in any lesson.
  plate("112-opened", "op112", [ev("ADDED"), ev("RECEIVED", "s2")]),
  // A card typed at 112 nobody touched: the place's only when the lesson takes the students' cards.
  plate("112-idle", "op112", [ev("ADDED")]),
];

beforeEach(() => {
  store.plates = PLATES;
  store.seats = [seat("generated")];
  store.reviewed = [];
});

describe("end-of-lesson review of a ДДС place", () => {
  it("skips plates that never reached the place: answered by the system, or a 112 card in a lesson of generated cards", async () => {
    expect(await evaluateSeatPlates(seat("generated"))).toBe(2);
    expect(store.reviewed).toEqual(["own-idle", "112-opened"]);
  });

  it("reviews a 112 card nobody touched when the lesson takes the students' cards; never one the system answered", async () => {
    for (const cardSource of ["students", "mixed"]) {
      store.reviewed = [];
      expect(await evaluateSeatPlates(seat(cardSource))).toBe(3);
      expect(store.reviewed).toEqual(["own-idle", "112-opened", "112-idle"]);
    }
  });

  it("the teacher's «finish lesson» follows the same rule", async () => {
    expect(await finishLessonEvaluation("l1")).toBe(2);
    expect(store.reviewed).toEqual(["own-idle", "112-opened"]);
  });
});
