import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeModel, matches } from "./fake-db";

type Row = Record<string, unknown>;

/**
 * «Завершить занятие» hangs up the conversations of the 112 places: the caller does not stay on the line in a
 * finished lesson. The ДДС places' calls are left to their own end-of-lesson review (mocked here).
 */
const state = vi.hoisted(() => ({
  user: { id: "smirnova", login: "teacher", fullName: "Смирнова", role: "TEACHER" as "TEACHER" | "ADMIN" | "STUDENT" },
  lessons: [] as Record<string, unknown>[],
  calls: [] as Record<string, unknown>[],
  audit: [] as Record<string, unknown>[],
  ddsReview: [] as string[],
}));

function model(rows: Row[]) {
  return {
    ...fakeModel(rows),
    updateMany: async ({ where, data }: { where: Row; data: Row }) => {
      const hit = rows.filter((r) => matches(r, where));
      for (const r of hit) Object.assign(r, data);
      return { count: hit.length };
    },
  };
}

vi.mock("@/lib/db", () => ({ db: { lesson: model(state.lessons), call: model(state.calls) } }));
vi.mock("@/lib/audit", () => ({ audit: async (row: Record<string, unknown>) => void state.audit.push(row) }));
vi.mock("@/lib/dds/review", () => ({ finishLessonEvaluation: async (id: string) => void state.ddsReview.push(id) }));
vi.mock("@/lib/auth/session", () => ({
  apiUser: async (roles?: string[]) => (roles && !roles.includes(state.user.role) ? Response.json({ error: "forbidden" }, { status: 403 }) : state.user),
}));

const stop = (await import("@/app/api/teacher/lessons/[id]/stop/route")).POST;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = () => new Request("http://x", { method: "POST", body: "{}" });

const seat112 = { role: "OP112" };
const seatDds = { role: "DDS" };
const call = (id: string, lessonId: string, status: string, seat: Row, kind = "CALLER_IN") => ({ id, lessonId, status, seat, kind, endedAt: null });

beforeEach(() => {
  state.user = { id: "smirnova", login: "teacher", fullName: "Смирнова", role: "TEACHER" };
  state.lessons.splice(
    0,
    Infinity,
    { id: "l1", teacherId: "smirnova", status: "RUNNING", startedAt: new Date("2026-09-28T08:00:00Z") },
    { id: "l-orlov", teacherId: "orlov", status: "RUNNING", startedAt: new Date("2026-09-28T08:00:00Z") },
  );
  state.calls.splice(
    0,
    Infinity,
    call("talking", "l1", "ACTIVE", seat112),
    call("ringing", "l1", "RINGING", seat112),
    call("service", "l1", "ACTIVE", seat112, "SERVICE_OUT"),
    call("done", "l1", "ENDED", seat112),
    call("dds-crew", "l1", "ACTIVE", seatDds, "BRIGADE_IN"),
    call("other-lesson", "l-orlov", "ACTIVE", seat112),
  );
  state.audit.splice(0, Infinity);
  state.ddsReview.splice(0, Infinity);
});

const statusOf = (id: string) => state.calls.find((c) => c.id === id)?.status;

describe("«Завершить занятие» ends the conversations at the 112 places", () => {
  it("hangs up the caller and the service calls, marks a ringing call missed and writes it to the journal", async () => {
    const res = await stop(post(), ctx("l1"));
    expect(res.status).toBe(200);
    expect(statusOf("talking")).toBe("ENDED");
    expect(statusOf("service")).toBe("ENDED");
    expect(statusOf("ringing")).toBe("MISSED");
    const talking = state.calls.find((c) => c.id === "talking")!;
    expect(talking.endedAt).toBeInstanceOf(Date);
    expect(statusOf("done")).toBe("ENDED");
    // ДДС calls are closed by the ДДС review with their hold periods; another lesson is not touched.
    expect(statusOf("dds-crew")).toBe("ACTIVE");
    expect(state.ddsReview).toEqual(["l1"]);
    expect(statusOf("other-lesson")).toBe("ACTIVE");
    expect(state.audit.at(-1)).toMatchObject({ action: "lesson.stop", entityId: "l1", after: { status: "FINISHED", callsEnded: 2, callsMissed: 1 } });
  });

  it("closes nothing in another teacher's lesson", async () => {
    expect((await stop(post(), ctx("l-orlov"))).status).toBe(404);
    expect(statusOf("other-lesson")).toBe("ACTIVE");
    expect(state.lessons[1].status).toBe("RUNNING");
  });

  it("does nothing for a lesson that is not running", async () => {
    state.lessons[0].status = "FINISHED";
    expect((await stop(post(), ctx("l1"))).status).toBe(409);
    expect(statusOf("talking")).toBe("ACTIVE");
  });

  it("lets an administrator stop any lesson, and keeps students out", async () => {
    state.user = { id: "st", login: "student1", fullName: "Иванов", role: "STUDENT" };
    expect((await stop(post(), ctx("l1"))).status).toBe(403);
    expect(statusOf("talking")).toBe("ACTIVE");
    state.user = { id: "admin", login: "admin", fullName: "Администратор", role: "ADMIN" };
    expect((await stop(post(), ctx("l-orlov"))).status).toBe(200);
    expect(statusOf("other-lesson")).toBe("ENDED");
  });
});
