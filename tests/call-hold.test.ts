import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The phone of one ДДС place: a talk with an applicant and a crew report, plus a call of another place.
type CallRow = { id: string; seatId: string; status: string; holds: unknown; messages: unknown; counterpart: unknown; endedAt: Date | null; incident: null } & Record<string, unknown>;
const at = (sec: number) => new Date(Date.UTC(2026, 8, 27, 8, 0, sec));
let calls: CallRow[] = [];
const state = vi.hoisted(() => ({ busy: false, beforeTx: null as null | (() => void) }));

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

const fits = (c: CallRow, where: Record<string, unknown>) =>
  Object.entries(where).every(([k, v]) => {
    if (v && typeof v === "object" && "in" in v) return (v.in as unknown[]).includes(c[k]);
    if (v && typeof v === "object" && "lt" in v) return (c[k] as Date) < (v.lt as Date);
    return c[k] === v;
  });
const pick = (where: Record<string, unknown>) => calls.find((c) => fits(c, where)) ?? null;

vi.mock("@/lib/db", () => {
  const call = {
    findFirst: async ({ where }: { where: Record<string, unknown> }) => pick(where),
    findMany: async ({ where, take }: { where: Record<string, unknown>; take?: number }) =>
      calls
        .filter((c) => fits(c, where))
        .sort((a, b) => (b.startedAt as Date).getTime() - (a.startedAt as Date).getTime())
        .slice(0, take ?? Infinity),
    findUnique: async ({ where }: { where: Record<string, unknown> }) => pick(where),
    findUniqueOrThrow: async ({ where }: { where: Record<string, unknown> }) => pick(where)!,
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(pick(where)!, data),
    updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const hit = calls.filter((c) => fits(c, where));
      for (const c of hit) Object.assign(c, data);
      return { count: hit.length };
    },
  };
  const db: Record<string, unknown> = { call, incident: { findMany: async () => [] }, $executeRaw: async () => 0 };
  db.$transaction = async (fn: (tx: unknown) => unknown, opts?: { timeout?: number }) => {
    if (state.busy) throw new Prisma.PrismaClientKnownRequestError(`Transaction already closed: ${opts?.timeout}`, { code: "P2028", clientVersion: "test" });
    state.beforeTx?.(); // another tab acts between the first read and the transaction
    state.beforeTx = null;
    return fn(db);
  };
  return { db };
});

const { HOLD_MAX_SEC, hangUp, hold, phoneState, phoneTick, resume, say } = await import("@/lib/dds/calls");
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

  it("ends the conversation the user hung up even if a «Снять с удержания» parked it a moment ago", async () => {
    state.beforeTx = () => {
      byId("c-caller").status = "HELD";
      byId("c-caller").holds = [{ from: at(29).toISOString() }];
    };
    await hangUp(seat, "c-caller", at(30));
    expect(byId("c-caller")).toMatchObject({ status: "ENDED", endedAt: at(30), holds: [{ from: at(29).toISOString(), to: at(30).toISOString() }] });
  });

  it("keeps a held call on the phone however many calls came after it", async () => {
    for (let i = 0; i < 45; i++) calls.push({ ...byId("c-other"), id: `c-new-${i}`, seatId: "seat-1", status: "ENDED", startedAt: at(100 + i) });
    const phone = await phoneState({ ...(seat as object), service: null, serviceId: null } as never);
    expect(phone.held.map((c) => c.id)).toEqual(["c-crew"]);
    expect(phone.current?.id).toBe("c-caller");
    expect(phone.log.length).toBe(42); // the latest 40 plus the two calls still going on
  });

  it("lets a counterpart left on hold too long hang up", async () => {
    await phoneTick(await db(), seat, { brigadeReports: false } as never, new Date(at(5).getTime() + (HOLD_MAX_SEC + 1) * 1000));
    expect(byId("c-crew")).toMatchObject({ status: "ENDED" });
    expect((byId("c-crew").messages as { text: string }[]).at(-1)?.text).toMatch(/не дождался/i);
    expect(byId("c-caller").status).toBe("ACTIVE");
  });
});
const db = async () => (await import("@/lib/db")).db as never;
