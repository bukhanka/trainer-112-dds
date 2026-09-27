import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeModel } from "./fake-db";

// A card saved at a 112 place; a ДДС place has since reviewed its own plate of the same card (newer attempt).
const criteria = [{ code: "op112.typing_time", group: "timeliness", title: "Карточка сохранена за 3:44", ok: false, source: "rule" }];
const attempts = [
  { id: "a-112", incidentId: "i1", seatId: "seat-112", kind: "OP112", reviewStatus: "PENDING", criteria, override: null, teacherComment: null, createdAt: new Date("2026-09-27T09:10:00Z") },
  { id: "a-dds", incidentId: "i1", seatId: "seat-dds", kind: "DDS", reviewStatus: "PENDING", criteria: [], override: null, teacherComment: null, createdAt: new Date("2026-09-27T09:20:00Z") },
];
const state = vi.hoisted(() => ({ settings: {} as Record<string, unknown> }));

vi.mock("@/lib/db", () => ({ db: { attempt: fakeModel(attempts), weightProfile: fakeModel([]), scenario: fakeModel([]) } }));
vi.mock("@/lib/op112/access", () => ({
  op112User: async () => ({ id: "u1", login: "student1", fullName: "Иванов", role: "STUDENT" }),
  ownIncident: async () => ({ incident: { id: "i1", status: "registered", scenarioId: null }, seat: { id: "seat-112", lesson: { settings: state.settings } } }),
  jsonError: (message: string, status = 400) => Response.json({ error: message }, { status }),
}));
vi.mock("@/lib/op112/services", () => ({ serviceCatalog: async () => [] }));

const review = (await import("@/app/api/op112/incidents/[id]/review/route")).GET;
const ctx = { params: Promise.resolve({ id: "i1" }) };

describe("the 112 place: the student does not see the draft in a lesson", () => {
  beforeEach(() => {
    state.settings = {};
  });

  it("in a lesson says only that the card is saved: no score, no checks, no reference", async () => {
    const data = await (await review(new Request("http://x"), ctx)).json();
    expect(data).toEqual({ ready: true, hidden: true, reviewStatus: "PENDING" });
  });

  it("in a practice without a lesson shows its own review as a self-check", async () => {
    state.settings = { practice: true };
    const data = await (await review(new Request("http://x"), ctx)).json();
    expect(data).toMatchObject({ ready: true, selfCheck: true, reviewStatus: "PENDING" });
    // The place's own attempt, not the newer one of the ДДС place on the same card.
    expect(data.criteria).toEqual(criteria);
  });
});
