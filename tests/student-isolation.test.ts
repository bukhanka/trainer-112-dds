import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeModel } from "./fake-db";

// Two students with their own attempts; one of Петрова's attempts is still a draft.
const lesson = { id: "l1", title: "Занятие", startedAt: new Date("2026-09-25T07:00:00Z"), teacherId: "t1" };
const criteria = [
  { code: "street", group: "address", title: "Улица записана верно", ok: false, critical: true, evidence: "Дубининская", expected: "Дубнинская", source: "rule" },
  { code: "time", group: "timeliness", title: "Вовремя", ok: true, source: "rule" },
];
const attempts = [
  { id: "a-ivanov", studentId: "ivanov", kind: "DDS", createdAt: new Date("2026-09-25T07:10:00Z"), reviewStatus: "CONFIRMED", score: 40, criteria, override: null, teacherComment: "Сверяйте улицу", lesson, scenario: { title: "Прорыв трубы" }, incident: { number: 1 } },
  { id: "a-petrova-1", studentId: "petrova", kind: "OP112", createdAt: new Date("2026-09-25T07:11:00Z"), reviewStatus: "CONFIRMED", score: 90, criteria, override: { street: true }, teacherComment: null, lesson, scenario: null, incident: { number: 2 } },
  { id: "a-petrova-2", studentId: "petrova", kind: "OP112", createdAt: new Date("2026-09-25T07:20:00Z"), reviewStatus: "PENDING", score: 12, criteria, override: null, teacherComment: null, lesson, scenario: null, incident: { number: 3 } },
];

const session = vi.hoisted(() => ({ user: null as null | { id: string; login: string; fullName: string; role: "STUDENT" | "TEACHER" | "ADMIN" } }));

vi.mock("@/lib/db", () => ({ db: { attempt: fakeModel(attempts) } }));
vi.mock("@/lib/auth/session", () => ({
  apiUser: async (roles?: string[]) => {
    if (!session.user) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (roles && !roles.includes(session.user.role)) return Response.json({ error: "forbidden" }, { status: 403 });
    return session.user;
  },
}));

const { GET: results } = await import("@/app/api/student/results/route");
const { GET: attempt } = await import("@/app/api/student/attempts/[id]/route");
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

describe("student cabinet: nobody sees someone else's results", () => {
  beforeEach(() => {
    session.user = { id: "petrova", login: "student2", fullName: "Петрова", role: "STUDENT" };
  });

  it("lists only the student's own attempts", async () => {
    const res = await results();
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.attempts.map((a: { id: string }) => a.id).sort()).toEqual(["a-petrova-1", "a-petrova-2"]);
    expect(JSON.stringify(data)).not.toContain("a-ivanov");
    expect(JSON.stringify(data)).not.toContain("Сверяйте улицу");
  });

  it("hides the score and checks of an attempt that is still being reviewed", async () => {
    const data = await (await results()).json();
    const pending = data.attempts.find((a: { id: string }) => a.id === "a-petrova-2");
    expect(pending).toMatchObject({ status: "PENDING", score: null, failed: null });
    expect(data.summary).toMatchObject({ reviewed: 1, pending: 1, avgScore: 90 });

    const detail = await (await attempt(new Request("http://x"), ctx("a-petrova-2"))).json();
    expect(detail).toEqual(expect.objectContaining({ status: "PENDING" }));
    expect(detail.checks).toBeUndefined();
    expect(detail.score).toBeUndefined();
  });

  it("shows the breakdown of a confirmed own attempt with the teacher's corrections applied", async () => {
    const detail = await (await attempt(new Request("http://x"), ctx("a-petrova-1"))).json();
    expect(detail.score).toBe(90);
    expect(detail.checks.find((c: { code: string }) => c.code === "street")).toMatchObject({ ok: true, changedByTeacher: true });
  });

  it("shows «зачтено / не зачтено» only for confirmed attempts", async () => {
    const data = await (await results()).json();
    expect(data.attempts.find((a: { id: string }) => a.id === "a-petrova-1").pass).toEqual({ passed: true, reasons: [] });
    expect(data.attempts.find((a: { id: string }) => a.id === "a-petrova-2").pass).toBeNull();
    expect(data.summary).toMatchObject({ passed: 1, judged: 1 });
    const detail = await (await attempt(new Request("http://x"), ctx("a-petrova-1"))).json();
    expect(detail).toMatchObject({ pass: { passed: true }, passRules: "балл не ниже 70, без критичных ошибок" });
    const pending = await (await attempt(new Request("http://x"), ctx("a-petrova-2"))).json();
    expect(pending.pass).toBeUndefined();
  });

  it("answers 404 for another student's attempt, the same as for a missing one", async () => {
    const foreign = await attempt(new Request("http://x"), ctx("a-ivanov"));
    const missing = await attempt(new Request("http://x"), ctx("no-such"));
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual(await missing.json());
  });

  it("closes the student API to other roles and to anonymous users", async () => {
    session.user = { id: "t1", login: "teacher", fullName: "Смирнова", role: "TEACHER" };
    expect((await results()).status).toBe(403);
    session.user = null;
    expect((await results()).status).toBe(401);
    expect((await attempt(new Request("http://x"), ctx("a-ivanov"))).status).toBe(401);
  });
});
