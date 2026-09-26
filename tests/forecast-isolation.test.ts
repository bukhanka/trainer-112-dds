import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeModel } from "./fake-db";

// Two teachers. Иванов studies in Смирнова's group but also had a lesson with Орлов; Сидоров is Орлов's.
const settings = { ackSec: 30, typingSec: 65 };
const lessons = {
  smirnova: { id: "l-smirnova", teacherId: "smirnova", title: "Занятие Смирновой", startedAt: new Date("2026-09-20T07:00:00Z"), settings },
  orlov: { id: "l-orlov", teacherId: "orlov", title: "Занятие Орлова", startedAt: new Date("2026-09-22T07:00:00Z"), settings },
};
function attempt(id: string, studentId: string, lesson: (typeof lessons)["smirnova"], score: number, reviewStatus = "CONFIRMED") {
  return {
    id,
    studentId,
    lessonId: lesson.id,
    lesson,
    kind: "DDS",
    score,
    reviewStatus,
    createdAt: new Date(lesson.startedAt.getTime() + 600_000),
    reviewedAt: reviewStatus === "PENDING" ? null : new Date(lesson.startedAt.getTime() + 7_200_000),
    scenario: { difficulty: 4 },
    incident: null,
    incidentService: { addedAt: lesson.startedAt, events: [{ at: new Date(lesson.startedAt.getTime() + 20_000) }] },
  };
}
const attempts = [
  attempt("a-ivanov-own", "ivanov", lessons.smirnova, 82),
  attempt("a-ivanov-foreign", "ivanov", lessons.orlov, 11),
  attempt("a-petrova-draft", "petrova", lessons.smirnova, 60, "PENDING"),
  attempt("a-sidorov", "sidorov", lessons.orlov, 95),
];
const member = (id: string, fullName: string) => ({ user: { id, fullName, role: "STUDENT" } });
const groups = [
  { id: "g1", name: "Группа Смирновой", teacherId: "smirnova", members: [member("ivanov", "Иванов"), member("petrova", "Петрова")] },
  { id: "g2", name: "Группа Орлова", teacherId: "orlov", members: [member("sidorov", "Сидоров")] },
];

type Who = { id: string; login: string; fullName: string; role: "STUDENT" | "TEACHER" | "ADMIN" };
const session = vi.hoisted(() => ({ user: null as null | Who }));

vi.mock("@/lib/db", () => ({ db: { attempt: fakeModel(attempts), group: fakeModel(groups) } }));
vi.mock("@/lib/auth/session", () => ({
  apiUser: async (roles?: string[]) => {
    if (!session.user) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (roles && !roles.includes(session.user.role)) return Response.json({ error: "forbidden" }, { status: 403 });
    return session.user;
  },
}));

const studentForecast = (await import("@/app/api/student/forecast/route")).GET;
const teacherForecast = (await import("@/app/api/teacher/forecast/route")).GET;

describe("forecast: a student sees only own forecast", () => {
  beforeEach(() => {
    session.user = { id: "ivanov", login: "student1", fullName: "Иванов", role: "STUDENT" };
  });

  it("builds the forecast from the student's own confirmed attempts only", async () => {
    const res = await studentForecast();
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.forecast.score.series.map((p: { lessonId: string }) => p.lessonId).sort()).toEqual(["l-orlov", "l-smirnova"]);
    expect(JSON.stringify(data)).not.toContain("petrova");
    expect(JSON.stringify(data)).not.toContain("sidorov");
  });

  it("shows no forecast and no level movement from a draft", async () => {
    session.user = { id: "petrova", login: "student2", fullName: "Петрова", role: "STUDENT" };
    const data = await (await studentForecast()).json();
    expect(data.forecast.score).toBeNull();
    expect(data.forecast.time).toEqual({ OP112: null, DDS: null });
    expect(data.levels.every((l: { attempts: number }) => l.attempts === 0)).toBe(true);
  });

  it("is closed to other roles and to anonymous users", async () => {
    session.user = { id: "smirnova", login: "teacher", fullName: "Смирнова", role: "TEACHER" };
    expect((await studentForecast()).status).toBe(403);
    session.user = null;
    expect((await studentForecast()).status).toBe(401);
  });
});

describe("forecast: a teacher sees own groups and own lessons only", () => {
  beforeEach(() => {
    session.user = { id: "smirnova", login: "teacher", fullName: "Смирнова", role: "TEACHER" };
  });

  it("lists the students of own groups, not another teacher's", async () => {
    const data = await (await teacherForecast()).json();
    expect(data.rows.map((r: { studentId: string }) => r.studentId).sort()).toEqual(["ivanov", "petrova"]);
    expect(JSON.stringify(data)).not.toContain("Сидоров");
  });

  it("does not let another teacher's lesson into the forecast", async () => {
    const data = await (await teacherForecast()).json();
    const ivanov = data.rows.find((r: { studentId: string }) => r.studentId === "ivanov");
    expect(ivanov.score.series.map((p: { lessonId: string }) => p.lessonId)).toEqual(["l-smirnova"]);
    expect(ivanov.score.expected).toBe(82);
    expect(ivanov.levels.DDS.attempts).toBe(1);
  });

  it("keeps students and anonymous users out", async () => {
    session.user = { id: "ivanov", login: "student1", fullName: "Иванов", role: "STUDENT" };
    expect((await teacherForecast()).status).toBe(403);
    session.user = null;
    expect((await teacherForecast()).status).toBe(401);
  });
});
