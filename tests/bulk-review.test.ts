import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeScore, type CriterionResult } from "@/lib/scoring/score";
import { DEFAULT_WEIGHTS } from "@/lib/scoring/weight-config";
import { fakeModel, matches } from "./fake-db";

type Row = Record<string, unknown>;

/** fakeModel plus the writes a decision needs. */
function model(rows: Row[]) {
  return {
    ...fakeModel(rows),
    create: async ({ data }: { data: Row }) => {
      const row = { id: `new-${rows.length + 1}`, ...data };
      rows.push(row);
      return row;
    },
    createMany: async ({ data }: { data: Row[] }) => {
      rows.push(...data);
      return { count: data.length };
    },
    update: async ({ where, data }: { where: Row; data: Row }) => Object.assign(rows.find((r) => matches(r, where))!, data),
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hit = rows.filter((r) => matches(r, where));
      for (const r of hit) Object.assign(r, data);
      return { count: hit.length };
    },
  };
}

const check = (code: string, ok: boolean | null, critical = false) =>
  ({ code, group: code.startsWith("addr") ? "address" : "timeliness", title: `Проверка ${code}`, ok, critical, source: "rule" }) as CriterionResult;
const CLEAN = [check("time", true), check("addr", false)];
const CRITICAL = [check("time", true), check("addr.street", false, true)];

const lessonOf = (id: string, teacherId: string, status = "FINISHED") => ({ id, teacherId, status, title: id, settings: {}, startedAt: null, finishedAt: null });

const state = vi.hoisted(() => ({
  user: null as null | { id: string; login: string; fullName: string; role: "ADMIN" | "TEACHER" | "STUDENT" },
  lessons: [] as Record<string, unknown>[],
  attempts: [] as Record<string, unknown>[],
  corrections: [] as Record<string, unknown>[],
  audit: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", () => {
  const db: Record<string, unknown> = {
    lesson: model(state.lessons),
    attempt: model(state.attempts),
    teacherCorrection: model(state.corrections),
    followUp: fakeModel([]),
    weightProfile: fakeModel([]),
    incidentType: fakeModel([]),
    auditLog: model(state.audit),
    $executeRaw: async () => 0,
  };
  // Interactive transactions run on the same fake; the advisory lock is a no-op here.
  db.$transaction = async (fn: (tx: unknown) => unknown) => fn(db);
  return { db };
});
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
vi.mock("@/lib/auth/session", () => ({
  apiUser: async (roles?: string[]) => {
    if (!state.user) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (roles && !roles.includes(state.user.role)) return Response.json({ error: "forbidden" }, { status: 403 });
    return state.user;
  },
}));

const bulk = (await import("@/app/api/teacher/lessons/[id]/attempts/confirm/route")).POST;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });

const SMIRNOVA = { id: "smirnova", login: "teacher", fullName: "Смирнова", role: "TEACHER" as const };
const ORLOV = { id: "orlov", login: "teacher2", fullName: "Орлов", role: "TEACHER" as const };
const ADMIN = { id: "admin", login: "admin", fullName: "Администратор", role: "ADMIN" as const };

function attemptOf(id: string, lesson: Record<string, unknown>, extra: Row = {}) {
  return {
    id,
    kind: "DDS",
    lessonId: lesson.id,
    lesson,
    reviewStatus: "PENDING",
    criteria: CLEAN,
    override: null,
    score: 0,
    teacherComment: null,
    reviewedBy: null,
    reviewedById: null,
    scenarioId: null,
    scenario: null,
    incident: null,
    ...extra,
  };
}

const find = (id: string) => state.attempts.find((a) => a.id === id)!;
const actions = () => state.audit.map((a) => `${a.action}:${a.entityId}`);

beforeEach(() => {
  state.user = SMIRNOVA;
  const own = lessonOf("l-own", "smirnova");
  const ownOther = lessonOf("l-own-2", "smirnova");
  const foreign = lessonOf("l-orlov", "orlov");
  const running = lessonOf("l-running", "smirnova", "RUNNING");
  state.lessons.splice(0, Infinity, own, ownOther, foreign, running);
  state.attempts.splice(
    0,
    Infinity,
    attemptOf("a1", own),
    attemptOf("a2", own),
    attemptOf("a-critical", own, { criteria: CRITICAL }),
    attemptOf("a-done", own, { reviewStatus: "CONFIRMED", score: 55, reviewedById: "smirnova" }),
    attemptOf("a-reopened", own, { override: { addr: true }, teacherComment: "Адрес верный", score: 100 }),
    attemptOf("a-other-lesson", ownOther),
    attemptOf("a-orlov", foreign),
    attemptOf("a-running", running),
  );
  state.corrections.splice(0, Infinity);
  state.audit.splice(0, Infinity);
});

describe("«Утвердить выбранные»: many drafts confirmed as they are, each like «Верно»", () => {
  it("confirms the chosen attempts with the draft score, one audit record each and one for the list", async () => {
    const res = await bulk(post({ ids: ["a1", "a2"] }), ctx("l-own"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, confirmed: 2, skipped: { decided: 0, edited: 0, critical: 0, missing: 0 } });
    for (const id of ["a1", "a2"]) {
      expect(find(id)).toMatchObject({ reviewStatus: "CONFIRMED", reviewedById: "smirnova", score: computeScore(CLEAN, DEFAULT_WEIGHTS, null), teacherComment: null });
      expect(find(id).reviewedAt).toBeInstanceOf(Date);
    }
    expect(actions()).toEqual(["attempt.confirm:a1", "attempt.confirm:a2", "attempt.bulk_confirm:l-own"]);
    expect(state.audit[0]).toMatchObject({
      actor: "teacher",
      entity: "Attempt",
      before: { reviewStatus: "PENDING", reviewedBy: null },
      after: { reviewStatus: "CONFIRMED", reviewedBy: "teacher", via: "bulk", corrections: { created: 0, retired: 0 } },
    });
    expect(state.audit[2]).toEqual(expect.objectContaining({ entity: "Lesson", after: { confirmed: 2, noCritical: false } }));
  });

  it("«без критичных ошибок» leaves a critical draft on review", async () => {
    const res = await bulk(post({ ids: ["a1", "a-critical"], noCritical: true }), ctx("l-own"));
    expect(await res.json()).toMatchObject({ confirmed: 1, skipped: { critical: 1 } });
    expect(find("a1").reviewStatus).toBe("CONFIRMED");
    expect(find("a-critical").reviewStatus).toBe("PENDING");
    expect(state.audit.at(-1)).toMatchObject({ action: "attempt.bulk_confirm", after: { confirmed: 1, noCritical: true, skippedCritical: 1 } });
  });

  it("leaves decided attempts and the ones the teacher already changed as they are", async () => {
    const res = await bulk(post({ ids: ["a-done", "a-reopened"] }), ctx("l-own"));
    expect(await res.json()).toMatchObject({ confirmed: 0, skipped: { decided: 1, edited: 1 } });
    expect(state.audit.at(-1)).toMatchObject({ after: { confirmed: 0, skippedDecided: 1, skippedEdited: 1 } });
    expect(find("a-done")).toMatchObject({ reviewStatus: "CONFIRMED", score: 55 });
    expect(find("a-reopened")).toMatchObject({ reviewStatus: "PENDING", override: { addr: true }, teacherComment: "Адрес верный", score: 100 });
    expect(actions()).toEqual(["attempt.bulk_confirm:l-own"]);
  });

  it("retires the attempt's teacher corrections, like «Верно» on its screen («Учёт правок»)", async () => {
    state.corrections.push({ id: "c1", attemptId: "a1", code: "addr", teacherOk: true, comment: "было", active: true });
    await bulk(post({ ids: ["a1"] }), ctx("l-own"));
    expect(state.corrections[0]).toMatchObject({ active: false, offReason: "revised", offByName: "Смирнова" });
    expect(actions()).toEqual(["correction.revise:c1", "attempt.confirm:a1", "attempt.bulk_confirm:l-own"]);
    expect(state.audit[1]).toMatchObject({ after: { corrections: { created: 0, retired: 1 } } });
  });
});

describe("«Утвердить списком»: access is the one of a single decision", () => {
  it("confirms nothing of another lesson, even the teacher's own, through this lesson", async () => {
    const res = await bulk(post({ ids: ["a-other-lesson", "a-orlov", "gone"] }), ctx("l-own"));
    expect(await res.json()).toMatchObject({ confirmed: 0, skipped: { missing: 3 } });
    expect(find("a-other-lesson").reviewStatus).toBe("PENDING");
    expect(find("a-orlov").reviewStatus).toBe("PENDING");
  });

  it("answers «not found» for another teacher's lesson and writes nothing", async () => {
    const res = await bulk(post({ ids: ["a-orlov"] }), ctx("l-orlov"));
    expect(res.status).toBe(404);
    expect(find("a-orlov").reviewStatus).toBe("PENDING");
    expect(state.audit).toEqual([]);
  });

  it("refuses while the lesson is running", async () => {
    const res = await bulk(post({ ids: ["a-running"] }), ctx("l-running"));
    expect(res.status).toBe(409);
    expect(find("a-running").reviewStatus).toBe("PENDING");
  });

  it("lets an administrator confirm in any lesson", async () => {
    state.user = ADMIN;
    const res = await bulk(post({ ids: ["a-orlov"] }), ctx("l-orlov"));
    expect(await res.json()).toMatchObject({ confirmed: 1 });
    expect(find("a-orlov")).toMatchObject({ reviewStatus: "CONFIRMED", reviewedById: "admin" });
  });

  it("keeps another teacher, students and anonymous users out, and refuses a broken request", async () => {
    state.user = ORLOV;
    expect((await bulk(post({ ids: ["a1"] }), ctx("l-own"))).status).toBe(404);
    state.user = { id: "ivanov", login: "student1", fullName: "Иванов", role: "STUDENT" };
    expect((await bulk(post({ ids: ["a1"] }), ctx("l-own"))).status).toBe(403);
    state.user = null;
    expect((await bulk(post({ ids: ["a1"] }), ctx("l-own"))).status).toBe(401);
    state.user = SMIRNOVA;
    expect((await bulk(post({ ids: [] }), ctx("l-own"))).status).toBe(400);
    expect((await bulk(new Request("http://x", { method: "POST", body: "{" }), ctx("l-own"))).status).toBe(400);
    expect(find("a1").reviewStatus).toBe("PENDING");
    expect(state.audit).toEqual([]);
  });
});
