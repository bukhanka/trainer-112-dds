import { describe, expect, it } from "vitest";
import { caseHeardOnCall, seenSituations } from "./exposure";

describe("situations a student has met", () => {
  it("counts a call as an exposure before any 112 card was saved, including a copied case", () => {
    expect(caseHeardOnCall(["original", "copy"], [{ counterpart: { scenarioId: "copy" } }])).toBe(true);
    expect(caseHeardOnCall(["original", "copy"], [{ counterpart: { scenarioId: "other" } }])).toBe(false);
  });

  it("gathers calls, cards and attempts of every place of the student, a ticket's «-ош» variant as the same case", async () => {
    const client = {
      seat: { findMany: async () => [{ id: "seat-112", studentId: "s1" }, { id: "seat-dds", studentId: "s1" }, { id: "seat-other", studentId: "s2" }] },
      incident: { findMany: async () => [{ scenarioId: "card-err", createdBySeatId: null, ddsSeatId: "seat-dds" }] },
      call: { findMany: async () => [{ seatId: "seat-112", counterpart: { scenarioId: "missed" } }] },
      attempt: { findMany: async () => [{ studentId: "s2", scenarioId: "copy" }] },
      scenario: { findMany: async () => [
        { id: "card-err", ticketRef: "Б5-1-ош", learningMeta: null },
        { id: "missed", ticketRef: "Б11-1", learningMeta: null },
        { id: "copy", ticketRef: null, learningMeta: { purpose: "control", role: "OP112", skillKeys: ["op112.location"], equivalenceKey: "g", caseKey: "ticket:Б25-1" } },
      ] },
    };
    const seen = await seenSituations(client as never, ["s1", "s2"]);
    expect([...seen.get("s1")!]).toEqual(expect.arrayContaining(["situation:Б5-1", "situation:Б11-1"]));
    expect(seen.get("s1")!.has("case:ticket:Б25-1")).toBe(false);
    expect(seen.get("s2")!.has("case:ticket:Б25-1")).toBe(true);
  });
});
