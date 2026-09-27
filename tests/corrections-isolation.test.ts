import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeModel, matches } from "./fake-db";

type Row = Record<string, unknown>;

/** fakeModel plus the writes the corrections need. */
function model(rows: Row[]) {
  return {
    ...fakeModel(rows),
    create: async ({ data }: { data: Row }) => {
      const row = { id: `new-${rows.length + 1}`, active: true, offReason: null, createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => Object.assign(rows.find((r) => matches(r, where))!, data),
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hit = rows.filter((r) => matches(r, where));
      for (const r of hit) Object.assign(r, data);
      return { count: hit.length };
    },
  };
}

const check = { code: "dds.ai.literacy", group: "literacy", title: "ИИ: комментарии понятны следующему диспетчеру", ok: false, evidence: "Непонятно: «АБ»", source: "ai" };
const lessonOf = (teacherId: string) => ({ id: `l-${teacherId}`, teacherId, status: "FINISHED" });
const attemptOf = (teacherId: string) => ({
  id: `a-${teacherId}`,
  kind: "DDS",
  lessonId: `l-${teacherId}`,
  lesson: lessonOf(teacherId),
  reviewStatus: "PENDING",
  criteria: [check],
  override: null,
  score: 0,
  teacherComment: null,
  reviewedBy: null,
  scenarioId: "s-gas",
  scenario: { title: "Запах газа", category: "газ", truth: { typeCodes: [] } },
  incident: { typeCodes: [] },
});
const correctionOf = (id: string, authorId: string, extra: Row = {}) => ({
  id,
  authorId,
  authorName: authorId === "smirnova" ? "Смирнова" : "Орлов",
  attemptId: `a-${authorId}`,
  role: "DDS",
  code: "dds.ai.literacy",
  title: check.title,
  source: "ai",
  active: true,
  offReason: null,
  offByName: null,
  offAt: null,
  scenarioTitle: "Запах газа",
  typeName: null,
  draftOk: false,
  draftEvidence: "Непонятно: «АБ»",
  teacherOk: true,
  comment: "АБ — аварийная бригада, так пишут все",
  createdAt: new Date("2026-09-25T09:00:00Z"),
  ...extra,
});

const state = vi.hoisted(() => ({
  user: null as null | { id: string; login: string; fullName: string; role: "ADMIN" | "TEACHER" | "STUDENT" },
  attempts: [] as Row[],
  corrections: [] as Row[],
  audit: [] as Row[],
}));

vi.mock("@/lib/db", () => {
  const db: Record<string, unknown> = {
    attempt: model(state.attempts),
    teacherCorrection: model(state.corrections),
    weightProfile: fakeModel([]),
    incidentType: fakeModel([]),
    auditLog: { create: async ({ data }: { data: Row }) => state.audit.push(data) },
    $executeRaw: async () => 0,
    $queryRaw: async () => [{ id: "c-smirnova", n: BigInt(2) }],
  };
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

const toggle = (await import("@/app/api/teacher/corrections/[id]/route")).POST;
const review = (await import("@/app/api/teacher/attempts/[id]/review/route")).POST;
const { listCorrections } = await import("@/lib/review/corrections-db");
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });

const SMIRNOVA = { id: "smirnova", login: "teacher", fullName: "Смирнова", role: "TEACHER" as const };
const ORLOV = { id: "orlov", login: "teacher2", fullName: "Орлов", role: "TEACHER" as const };
const ADMIN = { id: "admin", login: "admin", fullName: "Администратор", role: "ADMIN" as const };

beforeEach(() => {
  state.user = SMIRNOVA;
  state.attempts.splice(0, Infinity, attemptOf("smirnova"), attemptOf("orlov"));
  state.corrections.splice(0, Infinity, correctionOf("c-smirnova", "smirnova"), correctionOf("c-orlov", "orlov"), correctionOf("c-revised", "smirnova", { active: false, offReason: "revised" }));
  state.audit.splice(0, Infinity);
});

describe("switching a correction off: the author or an administrator", () => {
  it("lets the author switch own correction off and on, with an audit record", async () => {
    const off = await toggle(post({ active: false }), ctx("c-smirnova"));
    expect(off.status).toBe(200);
    expect(state.corrections[0]).toMatchObject({ active: false, offReason: "off", offByName: "Смирнова" });
    expect(state.audit.at(-1)).toMatchObject({ action: "correction.off", entityId: "c-smirnova", actor: "teacher" });
    expect((await toggle(post({ active: true }), ctx("c-smirnova"))).status).toBe(200);
    expect(state.corrections[0]).toMatchObject({ active: true, offReason: null });
  });

  it("does not let another teacher switch it", async () => {
    state.user = ORLOV;
    const res = await toggle(post({ active: false }), ctx("c-smirnova"));
    expect(res.status).toBe(403);
    expect(state.corrections[0].active).toBe(true);
    expect(state.audit).toHaveLength(0);
  });

  it("lets an administrator switch anyone's correction", async () => {
    state.user = ADMIN;
    expect((await toggle(post({ active: false }), ctx("c-orlov"))).status).toBe(200);
    expect(state.corrections[1]).toMatchObject({ active: false, offByName: "Администратор" });
  });

  it("keeps a correction replaced by a newer decision off", async () => {
    expect((await toggle(post({ active: true }), ctx("c-revised"))).status).toBe(409);
  });

  it("keeps students and anonymous users out", async () => {
    state.user = { id: "ivanov", login: "student1", fullName: "Иванов", role: "STUDENT" };
    expect((await toggle(post({ active: false }), ctx("c-smirnova"))).status).toBe(403);
    state.user = null;
    expect((await toggle(post({ active: false }), ctx("c-smirnova"))).status).toBe(401);
    expect(state.corrections[0].active).toBe(true);
  });

  it("answers 404 for an unknown correction and 400 for a broken request", async () => {
    expect((await toggle(post({ active: false }), ctx("nope"))).status).toBe(404);
    expect((await toggle(post({ active: "no" }), ctx("c-smirnova"))).status).toBe(400);
  });
});

describe("the corrections page: shared methodology, own attempts only", () => {
  it("shows every teacher's corrections but links only to own attempts", async () => {
    const list = await listCorrections(SMIRNOVA);
    expect(list.items.map((c) => c.id).sort()).toEqual(["c-orlov", "c-revised", "c-smirnova"]);
    const orlov = list.items.find((c) => c.id === "c-orlov")!;
    expect(orlov).toMatchObject({ attemptId: null, canSwitch: false, mine: false });
    expect(list.items.find((c) => c.id === "c-smirnova")).toMatchObject({ attemptId: "a-smirnova", canSwitch: true, mine: true, used: 2 });
    expect(list.stats).toMatchObject({ active: 2, learning: 2, used: 2 });
  });

  it("filters to own corrections and gives an administrator every link", async () => {
    expect((await listCorrections(SMIRNOVA, { mine: true })).items.every((c) => c.mine)).toBe(true);
    const admin = await listCorrections(ADMIN);
    expect(admin.items.find((c) => c.id === "c-orlov")).toMatchObject({ attemptId: "a-orlov", canSwitch: true });
  });
});

describe("the teacher's decision keeps the corrections", () => {
  it("«ИИ неправ» adds a correction of the changed check; «Верно» afterwards retires it", async () => {
    state.corrections.splice(0, Infinity);
    const res = await review(post({ action: "override", override: { "dds.ai.literacy": true }, comment: "АБ — аварийная бригада" }), ctx("a-smirnova"));
    expect(res.status).toBe(200);
    expect(state.corrections).toHaveLength(1);
    expect(state.corrections[0]).toMatchObject({
      attemptId: "a-smirnova",
      authorId: "smirnova",
      role: "DDS",
      code: "dds.ai.literacy",
      draftOk: false,
      teacherOk: true,
      comment: "АБ — аварийная бригада",
      scenarioId: "s-gas",
      category: "газ",
    });
    expect(state.audit.map((a) => a.action)).toEqual(["correction.add", "attempt.override"]);

    const confirm = await review(post({ action: "confirm" }), ctx("a-smirnova"));
    expect(confirm.status).toBe(200);
    expect(state.corrections[0]).toMatchObject({ active: false, offReason: "revised" });
  });

  it("creates nothing through another teacher's attempt", async () => {
    state.corrections.splice(0, Infinity);
    const res = await review(post({ action: "override", override: { "dds.ai.literacy": true }, comment: "так можно" }), ctx("a-orlov"));
    expect(res.status).toBe(404);
    expect(state.corrections).toHaveLength(0);
  });
});
