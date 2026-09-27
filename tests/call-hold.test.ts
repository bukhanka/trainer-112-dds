import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The phone of one ДДС place: a talk with an applicant and a crew report, plus a call of another place.
type CallRow = { id: string; seatId: string; status: string; holds: unknown; messages: unknown; counterpart: unknown; endedAt: Date | null; incident: null } & Record<string, unknown>;
const at = (sec: number) => new Date(Date.UTC(2026, 8, 27, 8, 0, sec));
let calls: CallRow[] = [];
const state = vi.hoisted(() => ({ busy: false }));

function reset() {
  const call = (id: string, seatId: string, status: string, kind: string): CallRow => ({
    id,
    seatId,
    status,
    holds: [],
    messages: [{ role: "counterpart", text: "Алло", at: at(0).toISOString() }],
    counterpart: { kind, name: kind === "crew" ? "Петров" : "Соколов", role: "" },
    endedAt: null,
    startedAt: at(0),
    answeredAt: at(0),
    kind: kind === "crew" ? "BRIGADE_IN" : "CALLER_OUT",
    incidentId: null,
    incident: null,
  });
  calls = [call("c-caller", "seat-1", "ACTIVE", "caller"), call("c-crew", "seat-1", "HELD", "crew"), call("c-other", "seat-2", "ACTIVE", "caller")];
  calls[1].holds = [{ from: at(5).toISOString() }];
}

const pick = (where: Record<string, unknown>) =>
  calls.find((c) => Object.entries(where).every(([k, v]) => (v && typeof v === "object" && "in" in v ? (v.in as unknown[]).includes(c[k]) : c[k] === v))) ?? null;

vi.mock("@/lib/db", () => {
  const call = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => pick(where),
    findUnique: async ({ where }: { where: Record<string, unknown> }) => pick(where),
    findUniqueOrThrow: async ({ where }: { where: Record<string, unknown> }) => pick(where)!,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(pick(where)!, data),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = calls.filter((c) => Object.entries(where).every(([k, v]) => c[k] === v));
      for (const c of hit) Object.assign(c, data);
      return { count: hit.length };
    },
  };
  const db: Record<string, unknown> = { call, $executeRaw: async () => 0 };
  db.$transaction = async (fn: (tx: unknown) => unknown, opts?: { timeout?: number }) => {
    if (state.busy) throw new Prisma.PrismaClientKnownRequestError(`Transaction already closed: ${opts?.timeout}`, { code: "P2028", clientVersion: "test" });
    return fn(db);
  };
  return { db };
});

const { hangUp, hold, resume, say } = await import("@/lib/dds/calls");
const seat = { id: "seat-1", lessonId: "l1", serviceId: 1, service: { id: 1, shortName: "Поселение Вороновское" }, lesson: { status: "RUNNING", settings: {} } } as never;
const byId = (id: string) => calls.find((c) => c.id === id)!;

describe("ДДС phone: «Удержание»", () => {
  beforeEach(() => {
    reset();
    state.busy = false;
  });

  it("puts the talk on hold: the counterpart waits and the line is free", async () => {
    const res = await hold(seat, "c-caller", at(20));
    expect(res.ok).toBe(true);
    expect(byId("c-caller")).toMatchObject({ status: "HELD", holds: [{ from: at(20).toISOString() }] });
    expect(calls.filter((c) => c.seatId === "seat-1" && c.status === "ACTIVE")).toHaveLength(0);
    expect((await hold(seat, "c-caller", at(21))).ok).toBe(true); // a second click changes nothing
    expect(byId("c-caller").holds).toEqual([{ from: at(20).toISOString() }]);
  });

  it("does not talk into a held call", async () => {
    await hold(seat, "c-caller", at(20));
    const res = await say(seat, "c-caller", "Вы меня слышите?", at(25));
    expect(res).toMatchObject({ ok: false, code: 409 });
    expect(!res.ok && res.error).toMatch(/удержании/);
  });

  it("takes a call off hold, closes the period, and parks the talk going on now", async () => {
    const res = await resume(seat, "c-crew", at(30));
    expect(res.ok).toBe(true);
    expect(byId("c-crew")).toMatchObject({ status: "ACTIVE", holds: [{ from: at(5).toISOString(), to: at(30).toISOString() }] });
    expect((byId("c-crew").messages as { role: string; text: string }[]).at(-1)).toMatchObject({ role: "counterpart", text: expect.stringMatching(/связи/) });
    expect(byId("c-caller")).toMatchObject({ status: "HELD", holds: [{ from: at(30).toISOString() }] });
    expect(byId("c-other").status).toBe("ACTIVE"); // another place's call is untouched
  });

  it("ends a held call with its hold period", async () => {
    const res = await hangUp(seat, "c-crew", at(40));
    expect(res.ok).toBe(true);
    expect(byId("c-crew")).toMatchObject({ status: "ENDED", endedAt: at(40), holds: [{ from: at(5).toISOString(), to: at(40).toISOString() }] });
  });

  it("answers «не найдено» for another place's call and refuses a finished one", async () => {
    expect(await hold(seat, "c-other", at(20))).toMatchObject({ ok: false, code: 404 });
    expect(await resume(seat, "c-other", at(20))).toMatchObject({ ok: false, code: 404 });
    byId("c-caller").status = "ENDED";
    expect(await hold(seat, "c-caller", at(20))).toMatchObject({ ok: false, code: 409 });
  });

  it("says in words that the server is busy instead of failing with 500", async () => {
    state.busy = true;
    const res = await hold(seat, "c-caller", at(20));
    expect(res).toMatchObject({ ok: false, code: 503 });
    expect(!res.ok && res.error).toMatch(/повторите/);
    expect(byId("c-caller").status).toBe("ACTIVE");
  });
});
