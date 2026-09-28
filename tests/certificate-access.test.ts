import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CriterionResult } from "@/lib/scoring/score";
import { fakeModel } from "./fake-db";

/**
 * «Сертификат о прохождении занятия»: a student sees only own certificates, a teacher — those of own lessons (an
 * administrator — all); a lesson without the student's place is «not found», like a missing one.
 */
const clean = [{ code: "time", group: "timeliness", title: "Время", ok: true, critical: false, source: "rule" }] as CriterionResult[];
const teacher = { fullName: "Смирнова Ольга Петровна" };
const group = { name: "Учебная группа № 1" };
const lessonOf = (id: string, teacherId: string, status = "FINISHED", settings: object = {}) => ({
  id,
  teacherId,
  title: `Занятие ${id}`,
  status,
  settings,
  startedAt: new Date("2026-09-21T07:00:00Z"),
  finishedAt: new Date("2026-09-21T08:00:00Z"),
  group,
  teacher,
});
const done = lessonOf("l-done", "smirnova");
const foreign = lessonOf("l-orlov", "orlov");
const practice = lessonOf("l-practice", "ivanov", "FINISHED", { practice: true });
const running = lessonOf("l-running", "smirnova", "RUNNING");
const lessons = [done, foreign, practice, running];

const people: Record<string, string> = { ivanov: "Иванов Алексей Сергеевич", petrova: "Петрова Мария Игоревна" };
const seat = (studentId: string, lesson: ReturnType<typeof lessonOf>, role = "OP112") => ({
  lessonId: lesson.id,
  studentId,
  role,
  lesson,
  student: { fullName: people[studentId] },
  service: role === "DDS" ? { shortName: "Поселение Вороновское" } : null,
});
const seats = [seat("ivanov", done), seat("petrova", done, "DDS"), seat("ivanov", foreign), seat("ivanov", practice), seat("ivanov", running)];

const attempt = (studentId: string, lessonId: string, reviewStatus: string, score: number, reviewedAt: string | null = "2026-09-22T10:00:00Z") => ({
  studentId,
  lessonId,
  reviewStatus,
  score,
  criteria: clean,
  override: null,
  reviewedAt: reviewedAt ? new Date(reviewedAt) : null,
});
const attempts = [
  attempt("ivanov", "l-done", "CONFIRMED", 80, "2026-09-22T10:00:00Z"),
  attempt("ivanov", "l-done", "OVERRIDDEN", 91, "2026-09-23T09:30:00Z"),
  attempt("petrova", "l-done", "CONFIRMED", 50),
  attempt("ivanov", "l-orlov", "PENDING", 95, null),
  attempt("ivanov", "l-practice", "CONFIRMED", 99),
];

const state = vi.hoisted(() => ({ user: { id: "ivanov", login: "student1", fullName: "Иванов", role: "STUDENT" as "STUDENT" | "TEACHER" | "ADMIN" } }));

vi.mock("@/lib/db", () => ({ db: { lesson: fakeModel(lessons), seat: fakeModel(seats), attempt: fakeModel(attempts) } }));
vi.mock("@/lib/auth/session", () => ({
  requireUser: async (roles: string[]) => {
    if (!roles.includes(state.user.role)) throw new Error("redirect to the own cabinet");
    return state.user;
  },
}));

const StudentPage = (await import("@/app/student/certificates/[lessonId]/page")).default;
const TeacherPage = (await import("@/app/teacher/lessons/[id]/certificate/[studentId]/page")).default;
const { studentCertificates, certificateVerdict, passedWord, certificateNumber } = await import("@/lib/reports/certificate");

type Shown = { props: { data: { studentName: string; verdict: { ok: boolean; score?: number; reason?: string }; issuedAt: string | null } } };
const student = async (lessonId: string) => (await StudentPage({ params: Promise.resolve({ lessonId }) } as never)) as unknown as Shown;
const teacherView = async (id: string, studentId: string) => (await TeacherPage({ params: Promise.resolve({ id, studentId }) } as never)) as unknown as Shown;
const notFound = { digest: expect.stringContaining("404") };

beforeEach(() => {
  state.user = { id: "ivanov", login: "student1", fullName: "Иванов", role: "STUDENT" };
});

describe("certificate: the student's own only", () => {
  it("gives the certificate for a lesson where every attempt is checked and «зачтено», with the average score", async () => {
    const shown = await student("l-done");
    expect(shown.props.data).toMatchObject({ studentName: "Иванов Алексей Сергеевич", verdict: { ok: true, score: 86 } });
    // Earned when the teacher took the last decision.
    expect(shown.props.data.issuedAt).toBe("2026-09-23T09:30:00.000Z");
  });

  it("explains why there is none yet: attempts on review, a failed attempt", async () => {
    expect((await student("l-orlov")).props.data.verdict).toMatchObject({ ok: false, reason: expect.stringContaining("не проверил") });
    state.user = { id: "petrova", login: "student2", fullName: "Петрова", role: "STUDENT" };
    expect((await student("l-done")).props.data.verdict).toMatchObject({ ok: false, reason: expect.stringContaining("Не зачтено") });
  });

  it("answers «not found» for a lesson without the student's place", async () => {
    state.user = { id: "petrova", login: "student2", fullName: "Петрова", role: "STUDENT" };
    await expect(student("l-orlov")).rejects.toMatchObject(notFound);
    await expect(student("nope")).rejects.toMatchObject(notFound);
  });

  it("lists only own earned certificates: not a practice, not a lesson on review", async () => {
    expect(await studentCertificates("ivanov")).toEqual([{ lessonId: "l-done", title: "Занятие l-done", date: "2026-09-21T07:00:00.000Z", score: 86 }]);
    expect(await studentCertificates("petrova")).toEqual([]);
  });

  it("keeps teachers out of the student's page", async () => {
    state.user = { id: "smirnova", login: "teacher", fullName: "Смирнова", role: "TEACHER" };
    await expect(student("l-done")).rejects.toThrow("redirect");
  });
});

describe("certificate from the lesson report: own lessons of the teacher", () => {
  beforeEach(() => {
    state.user = { id: "smirnova", login: "teacher", fullName: "Смирнова", role: "TEACHER" };
  });

  it("shows a student's certificate of an own lesson", async () => {
    expect((await teacherView("l-done", "ivanov")).props.data.verdict).toMatchObject({ ok: true, score: 86 });
    expect((await teacherView("l-done", "petrova")).props.data.verdict.ok).toBe(false);
  });

  it("answers «not found» for another teacher's lesson and for a student without a place", async () => {
    await expect(teacherView("l-orlov", "ivanov")).rejects.toMatchObject(notFound);
    await expect(teacherView("l-done", "sidorov")).rejects.toMatchObject(notFound);
  });

  it("lets an administrator open any lesson's certificate, and keeps students out", async () => {
    state.user = { id: "admin", login: "admin", fullName: "Администратор", role: "ADMIN" };
    expect((await teacherView("l-orlov", "ivanov")).props.data.studentName).toBe("Иванов Алексей Сергеевич");
    state.user = { id: "ivanov", login: "student1", fullName: "Иванов", role: "STUDENT" };
    await expect(teacherView("l-done", "ivanov")).rejects.toThrow("redirect");
  });
});

describe("certificateVerdict and the wording", () => {
  const rules = { passScore: 70, maxCritical: 0 };
  const a = (reviewStatus: "PENDING" | "CONFIRMED" | "OVERRIDDEN", score: number | null) => ({ reviewStatus, score, criteria: clean, override: null });

  it("needs a finished teacher's lesson, every attempt checked and passed", () => {
    expect(certificateVerdict({ status: "FINISHED", settings: {} }, [a("CONFIRMED", 70), a("OVERRIDDEN", 100)], rules)).toEqual({ ok: true, score: 85, passed: 2 });
    expect(certificateVerdict({ status: "RUNNING", settings: {} }, [a("CONFIRMED", 90)], rules).ok).toBe(false);
    expect(certificateVerdict({ status: "FINISHED", settings: { practice: true } }, [a("CONFIRMED", 90)], rules).ok).toBe(false);
    expect(certificateVerdict({ status: "FINISHED", settings: {} }, [], rules).ok).toBe(false);
    expect(certificateVerdict({ status: "FINISHED", settings: {} }, [a("CONFIRMED", 90), a("PENDING", 90)], rules).ok).toBe(false);
    expect(certificateVerdict({ status: "FINISHED", settings: {} }, [a("CONFIRMED", 90), a("CONFIRMED", 69)], rules)).toMatchObject({ ok: false, reason: expect.stringContaining("1 попытка из 2") });
    expect(certificateVerdict({ status: "FINISHED", settings: {} }, [a("CONFIRMED", null)], rules).ok).toBe(false);
    const critical = [{ ...clean[0], critical: true, ok: false }] as CriterionResult[];
    expect(certificateVerdict({ status: "FINISHED", settings: {} }, [{ reviewStatus: "CONFIRMED", score: 95, criteria: critical, override: null }], rules).ok).toBe(false);
  });

  it("says «прошёл / прошла» by the patronymic and numbers the certificate", () => {
    expect(passedWord("Иванов Алексей Сергеевич")).toBe("прошёл");
    expect(passedWord("Петрова Мария Игоревна")).toBe("прошла");
    expect(passedWord("Кузьмина Анна Ильинична")).toBe("прошла");
    expect(passedWord("Demo User")).toBe("прошёл(а)");
    expect(certificateNumber(new Date("2026-09-21T22:30:00Z"), "cl-lesson-abcd", "cl-student-wxyz")).toBe("20260922-ABCD-WXYZ");
  });
});
