import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeModel } from "./fake-db";

// Иванов sits in a running lesson (ДДС, two tasks) and in a planned one (112); Петрова — in the running one.
const teacher = { fullName: "Смирнова Ольга Петровна" };
const group = { name: "Учебная группа № 1" };
const running = { id: "l-run", title: "Смена в реальном темпе", status: "RUNNING", startedAt: new Date("2026-09-27T07:00:00Z"), settings: { adaptive: true }, group, teacher };
const draft = { id: "l-draft", title: "Итоговое занятие", status: "DRAFT", startedAt: null, settings: { adaptive: false, categories: ["Пожары"] }, group, teacher };
const practice = { id: "l-practice", title: "Тренировка без занятия", status: "RUNNING", startedAt: new Date(), settings: { practice: true }, group: null, teacher, teacherId: "ivanov" };
const mixed = { id: "l-mixed", title: "Смешанный поток", status: "DRAFT", startedAt: null, settings: { cardSource: "students" }, group, teacher };
const finished = { id: "l-done", title: "Прошлое", status: "FINISHED", startedAt: new Date("2026-09-20T07:00:00Z"), settings: {}, group, teacher };
type LessonRow = { id: string; title: string; status: string; startedAt: Date | null; settings: object; group: { name: string } | null; teacher: { fullName: string }; teacherId?: string };
const seat = (studentId: string, lesson: LessonRow, role: "DDS" | "OP112", scenarioIds: string[]) => ({
  studentId,
  lesson,
  role,
  label: "Место 1",
  scenarioIds,
  createdAt: new Date("2026-09-27T06:00:00Z"),
  service: role === "DDS" ? { shortName: "Поселение Вороновское" } : null,
});
const seats = [
  seat("ivanov", running, "DDS", ["sc-pipe", "sc-fire"]),
  seat("ivanov", draft, "OP112", []),
  seat("ivanov", practice, "DDS", ["sc-secret"]),
  ...Array.from({ length: 40 }, () => seat("ivanov", practice, "DDS", [])), // a shared demo account piles up practices
  seat("ivanov", mixed, "DDS", []),
  seat("ivanov", finished, "DDS", ["sc-secret"]),
  seat("petrova", running, "DDS", ["sc-secret"]),
];
const scenarios = [
  { id: "sc-pipe", title: "Прорыв трубы в подвале", category: "Коммунальные аварии", difficulty: 3 },
  { id: "sc-fire", title: "Пожар в квартире", category: "Пожары", difficulty: 5 },
  { id: "sc-secret", title: "Чужое задание Петровой", category: "Газ", difficulty: 7 },
];

// Attempts for «Время реакции»: ДДС answers in 20 s and 40 s (norm 30 s), a draft one in 5 s; Петрова — 90 s.
const lesson = { title: "Смена", startedAt: new Date("2026-09-25T07:00:00Z"), settings: { ackSec: 30, typingSec: 65 } };
const added = new Date("2026-09-25T07:10:00Z");
const plate = (sec: number) => ({ addedAt: added, events: [{ at: new Date(added.getTime() + sec * 1000) }] });
const attempt = (id: string, studentId: string, kind: "DDS" | "OP112", reviewStatus: string, extra: object) => ({
  id,
  studentId,
  lessonId: "l1",
  kind,
  score: 70,
  reviewStatus,
  createdAt: added,
  reviewedAt: reviewStatus === "PENDING" ? null : new Date("2026-09-25T09:00:00Z"),
  lesson,
  scenario: { difficulty: 3 },
  incident: null,
  incidentService: null,
  ...extra,
});
const attempts = [
  attempt("a1", "ivanov", "DDS", "CONFIRMED", { incidentService: plate(20) }),
  attempt("a2", "ivanov", "DDS", "OVERRIDDEN", { incidentService: plate(40) }),
  attempt("a3", "ivanov", "DDS", "PENDING", { incidentService: plate(5) }),
  attempt("a4", "ivanov", "OP112", "CONFIRMED", { incident: { createdAt: added, openedAt: added, savedAt: new Date(added.getTime() + 70_000) } }),
  attempt("a5", "petrova", "DDS", "CONFIRMED", { incidentService: plate(90) }),
];

const session = vi.hoisted(() => ({ user: null as null | { id: string; login: string; fullName: string; role: "STUDENT" | "TEACHER" | "ADMIN" } }));

// Seats honour `take`, like the database: the list must not be cut before the practices are left out.
const seatModel = fakeModel(seats);
const seatWithTake = { ...seatModel, findMany: async (args: { where?: Record<string, unknown>; take?: number }) => (await seatModel.findMany(args)).slice(0, args.take ?? Infinity) };
vi.mock("@/lib/db", () => ({ db: { seat: seatWithTake, scenario: fakeModel(scenarios), attempt: fakeModel(attempts) } }));
vi.mock("@/lib/auth/session", () => ({
  apiUser: async (roles?: string[]) => {
    if (!session.user) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (roles && !roles.includes(session.user.role)) return Response.json({ error: "forbidden" }, { status: 403 });
    return session.user;
  },
}));

const { GET: assignments } = await import("@/app/api/student/assignments/route");
const { GET: reaction } = await import("@/app/api/student/reaction/route");

describe("student cabinet: my tasks and reaction time are only mine", () => {
  beforeEach(() => {
    session.user = { id: "ivanov", login: "student1", fullName: "Иванов", role: "STUDENT" };
  });

  it("lists own places of running and planned lessons with the number of their tasks, not a practice or a finished lesson", async () => {
    const res = await assignments();
    expect(res.status).toBe(200);
    const { assignments: list } = await res.json();
    expect(list.map((a: { lessonId: string }) => a.lessonId)).toEqual(["l-run", "l-draft", "l-mixed"]);
    expect(list[2]).toMatchObject({ role: "DDS", from112: "only" });
    expect(list[0]).toMatchObject({ status: "RUNNING", role: "DDS", serviceName: "Поселение Вороновское", source: "tasks", taskCount: 2 });
    expect(list[1]).toMatchObject({ status: "DRAFT", role: "OP112", taskCount: 0, source: "categories" });
    expect(JSON.stringify(list)).not.toContain("Петровой");
  });

  it("never tells what the tasks are before the call: no titles, categories, difficulty or ids", async () => {
    const { assignments: list } = await (await assignments()).json();
    const json = JSON.stringify(list);
    for (const secret of ["Прорыв трубы", "Пожар в квартире", "Коммунальные аварии", "Пожары", "sc-pipe", "sc-fire"]) expect(json).not.toContain(secret);
    const keys = [...new Set(list.flatMap((a: object) => Object.keys(a)))].sort();
    expect(keys).toEqual(
      ["from112", "groupName", "lessonId", "lessonTitle", "role", "seatLabel", "serviceName", "source", "startedAt", "status", "taskCount", "teacherName"].sort(),
    );
  });

  it("counts reaction time from own confirmed attempts only", async () => {
    const res = await reaction();
    expect(res.status).toBe(200);
    const { reaction: r } = await res.json();
    expect(r.DDS).toEqual({ role: "DDS", attempts: 2, avgSec: 30, medianSec: 30, normSec: 30, onTime: 1 });
    expect(r.OP112).toEqual({ role: "OP112", attempts: 1, avgSec: 70, medianSec: 70, normSec: 65, onTime: 0 });
  });

  it("shows nothing to a student without places and confirmed attempts", async () => {
    session.user = { id: "sidorov", login: "student3", fullName: "Сидоров", role: "STUDENT" };
    expect((await (await assignments()).json()).assignments).toEqual([]);
    expect((await (await reaction()).json()).reaction).toEqual({ DDS: null, OP112: null });
  });

  it("is closed to other roles and to anonymous users", async () => {
    session.user = { id: "t1", login: "teacher", fullName: "Смирнова", role: "TEACHER" };
    expect((await assignments()).status).toBe(403);
    expect((await reaction()).status).toBe(403);
    session.user = null;
    expect((await assignments()).status).toBe(401);
    expect((await reaction()).status).toBe(401);
  });
});
