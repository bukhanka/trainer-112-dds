import { describe, expect, it, vi } from "vitest";

// Two cards of one repeated scenario: the same applicant with the same phone.
const caller = { fullName: "Ким Олег Юрьевич", status: "очевидец", aon: "+7 (916) 126-34-71" };
const incidents = [
  { id: "i-new", number: 36815537, services: [], scenario: null, caller, address: null, description: "Задымление", createdAt: new Date(2) },
  { id: "i-open", number: 36815532, services: [], scenario: null, caller, address: null, description: "Задымление", createdAt: new Date(1) },
];
const created: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => {
  const db: Record<string, unknown> = {
    incident: { findMany: async () => incidents },
    service: { findMany: async () => [] },
    call: {
      findFirst: async () => null,
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `c${created.length + 1}`, ...data };
        created.push(row);
        return row;
      },
      findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
        const row = created.find((c) => c.id === where.id)!;
        return { ...row, answeredAt: row.answeredAt ?? null, endedAt: null, holds: [], incident: incidents.find((i) => i.id === row.incidentId) ?? null };
      },
    },
    $executeRaw: async () => 0,
  };
  db.$transaction = async (fn: (tx: unknown) => unknown) => fn(db);
  return { db };
});

const { dial } = await import("@/lib/dds/calls");
const seat = { id: "seat-1", lessonId: "l1", serviceId: 7, service: { id: 7, shortName: "Поселение Хорошёво-Мнёвники", phone: null }, lesson: { status: "RUNNING", settings: {} } } as never;

describe("ДДС phone: the card open on the screen is the context of a call", () => {
  it("calls back the applicant of the open card, not of a newer card with the same number", async () => {
    const res = await dial(seat, "+7 (916) 126-34-71", null, new Date(), 36815532);
    expect(res.ok && res.call.incidentNumber).toBe(36815532);
  });

  it("without an open card falls back to the newest card", async () => {
    const res = await dial(seat, "+7 (916) 126-34-71", null, new Date());
    expect(res.ok && res.call.incidentNumber).toBe(36815537);
  });
});
