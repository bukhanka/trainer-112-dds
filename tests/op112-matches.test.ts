import { describe, expect, it, vi } from "vitest";
import { fakeModel } from "./fake-db";

// A mixed lesson: the 112 place saved one card on ул. Грина; the flow dealt the same situation to a ДДС place
// by itself (source «generated», «оп. 0»); a card of another lesson has the same address too.
const card = (id: string, over: Record<string, unknown>) => ({
  id,
  number: Number(id.replace(/\D/g, "")) || 1,
  savedAt: new Date("2026-09-27T09:00:00Z"),
  status: "registered",
  lessonId: "lesson",
  source: "op112",
  address: { street: "ул. Грина", house: "11", district: "Северное Бутово", okrug: "ЮЗАО" },
  caller: { aon: "+7 (916) 126-34-71" },
  tags: [],
  operatorNo: "1001",
  armNo: "1",
  linkedToId: null,
  linkedTo: null,
  scenario: { ticketRef: "Б4-1" },
  ...over,
});
const incidents = [
  card("c101", {}),
  card("c102", { source: "generated", operatorNo: "0", armNo: "3" }),
  card("c103", { lessonId: "other" }),
  card("c104", { status: "draft" }),
];

vi.mock("@/lib/db", () => ({ db: { incident: fakeModel(incidents) } }));

describe("«Совпадение» looks only at cards saved at the lesson's 112 places", () => {
  it("leaves out the cards the system dealt to ДДС places, other lessons and unsaved drafts", async () => {
    const { lessonCards } = await import("@/lib/op112/links-db");
    expect((await lessonCards("lesson")).map((c) => c.ref.id)).toEqual(["c101"]);
    expect(await lessonCards("lesson", "c101")).toEqual([]);
  });

  it("a repeat call waits for a card saved at a 112 place, not for the one dealt to a ДДС place", async () => {
    const { withoutEarlyRepeats } = await import("@/lib/op112/seat");
    const repeat = { id: "pv1", truth: { repeatOf: "Б4-1" } };
    const plain = { id: "b1", truth: {} };
    expect((await withoutEarlyRepeats([repeat, plain], "lesson")).map((s) => s.id)).toEqual(["pv1", "b1"]);
    incidents[0].source = "generated";
    expect((await withoutEarlyRepeats([repeat, plain], "lesson")).map((s) => s.id)).toEqual(["b1"]);
    incidents[0].source = "op112";
  });
});
