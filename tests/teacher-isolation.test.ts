import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeModel } from "./fake-db";

// Two teachers, each with a lesson and an attempt in it.
const lessons = [
  { id: "l-smirnova", teacherId: "smirnova", title: "Своё", status: "FINISHED", settings: {}, startedAt: null, finishedAt: null },
  { id: "l-orlov", teacherId: "orlov", title: "Чужое", status: "FINISHED", settings: {}, startedAt: null, finishedAt: null },
];
const attempts = [
  { id: "a-smirnova", lesson: lessons[0], lessonId: "l-smirnova" },
  { id: "a-orlov", lesson: lessons[1], lessonId: "l-orlov" },
];

const session = vi.hoisted(() => ({ user: { id: "smirnova", login: "teacher", fullName: "Смирнова", role: "TEACHER" as "TEACHER" | "ADMIN" | "STUDENT" } }));

vi.mock("@/lib/db", () => {
  // Interactive transactions run on the same fake; the advisory lock is a no-op here.
  const db: Record<string, unknown> = { lesson: fakeModel(lessons), attempt: fakeModel(attempts), $executeRaw: async () => 0 };
  db.$transaction = async (fn: (tx: unknown) => unknown) => fn(db);
  return { db };
});
vi.mock("@/lib/audit", () => ({ audit: async () => {} }));
vi.mock("@/lib/auth/session", () => ({
  apiUser: async (roles?: string[]) => (roles && !roles.includes(session.user.role) ? Response.json({ error: "forbidden" }, { status: 403 }) : session.user),
}));

const board = (await import("@/app/api/teacher/lessons/[id]/board/route")).GET;
const stop = (await import("@/app/api/teacher/lessons/[id]/stop/route")).POST;
const review = (await import("@/app/api/teacher/attempts/[id]/review/route")).POST;
const draft = (await import("@/app/api/teacher/attempts/[id]/draft/route")).POST;
const csv = (await import("@/app/api/teacher/lessons/[id]/report/csv/route")).GET;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });

describe("teacher cabinet: a teacher works only with own lessons", () => {
  beforeEach(() => {
    session.user = { id: "smirnova", login: "teacher", fullName: "Смирнова", role: "TEACHER" };
  });

  it("does not show another teacher's board, report or controls", async () => {
    expect((await board(new Request("http://x"), ctx("l-orlov"))).status).toBe(404);
    expect((await csv(new Request("http://x"), ctx("l-orlov"))).status).toBe(404);
    expect((await stop(post({}), ctx("l-orlov"))).status).toBe(404);
  });

  it("does not let a teacher review or redraft another teacher's attempt", async () => {
    expect((await review(post({ action: "confirm" }), ctx("a-orlov"))).status).toBe(404);
    expect((await draft(post({}), ctx("a-orlov"))).status).toBe(404);
  });

  it("keeps students out of the teacher API", async () => {
    session.user = { id: "ivanov", login: "student1", fullName: "Иванов", role: "STUDENT" };
    expect((await board(new Request("http://x"), ctx("l-smirnova"))).status).toBe(403);
    expect((await review(post({ action: "confirm" }), ctx("a-smirnova"))).status).toBe(403);
  });
});
