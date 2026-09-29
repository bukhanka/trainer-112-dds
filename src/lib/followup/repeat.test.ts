import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { readCriteria } from "@/lib/review/draft";
import { reviewDigest } from "./skills";
import { repeatStage } from "./service";

const at = new Date("2026-09-29T01:00:00Z");
const criteria = [{ code: "op112.address.house", group: "address", title: "Дом", ok: false, source: "rule" }];
const source = { id: "source", studentId: "s1", scenarioId: "src", reviewStatus: "CONFIRMED", reviewedAt: at, criteria, override: null, teacherComment: null };
const link = {
  id: "f1", skillKey: "op112.location", sourceAttemptId: "source", sourceAttempt: source, cancelledAt: null,
  sourceReviewDigest: reviewDigest({ criteria: readCriteria(criteria), override: null, reviewedAt: at, teacherComment: null }),
  sourceSnapshot: { role: "OP112", serviceId: null, practiceScenarioId: "p", controlScenarioId: "c" },
  practiceLessonId: "practice", practiceLesson: { id: "practice", title: "Отработка: адрес", status: "FINISHED", teacherId: "t", groupId: "g", settings: { hints: true }, seats: [] },
  controlLessonId: "control", controlLesson: { id: "control", title: "Контроль: занятие", status: "DRAFT", teacherId: "t", groupId: "g", settings: { hints: false }, seats: [] },
};
const user = { id: "t", login: "teacher", role: "TEACHER", fullName: "Учитель" };
const request = new Request("http://localhost/api");

function fakeTx(opts: { attempts?: unknown[]; classmates?: number }) {
  let n = 0;
  const calls = { lessons: [] as Record<string, unknown>[], seats: [] as Record<string, unknown>[], deleted: [] as unknown[], update: null as unknown, audit: null as unknown };
  const tx = {
    attempt: { findMany: async () => opts.attempts ?? [] },
    user: { findUnique: async () => ({ fullName: "Кузнецов Дмитрий Андреевич" }) },
    lesson: { create: async ({ data }: { data: Record<string, unknown> }) => { const row = { id: `new-${++n}`, ...data }; calls.lessons.push(row); return row; } },
    seat: { create: async ({ data }: { data: Record<string, unknown> }) => { calls.seats.push(data); return data; }, deleteMany: async (args: unknown) => { calls.deleted.push(args); return { count: 1 }; } },
    followUp: { count: async () => opts.classmates ?? 0, update: async (args: unknown) => { calls.update = args; return {}; } },
    auditLog: { create: async (args: unknown) => { calls.audit = args; return {}; } },
  };
  return { tx, calls };
}

describe("«Повторить отработку» after a practice without the student's attempt", () => {
  it("refuses while there is something to review or the stage is not over", async () => {
    const { tx } = fakeTx({ attempts: [{ id: "a", reviewStatus: "PENDING" }] });
    const done = await repeatStage(tx as never, user as never, request, link as never, "practice");
    expect(done).toEqual(expect.objectContaining({ ok: false, status: 409 }));
  });

  it("gives the student a new draft practice with the same case, keeps the finished one in history", async () => {
    const { tx, calls } = fakeTx({});
    const done = await repeatStage(tx as never, user as never, request, link as never, "practice");
    expect(done).toEqual(expect.objectContaining({ ok: true, state: "planned", controlLessonId: "control" }));
    expect(calls.lessons).toHaveLength(1);
    expect(calls.lessons[0]).toEqual(expect.objectContaining({ settings: { hints: true } }));
    expect(calls.seats[0]).toEqual(expect.objectContaining({ studentId: "s1", scenarioIds: ["p"], role: "OP112" }));
    expect(calls.update).toEqual(expect.objectContaining({ where: { id: "f1" } }));
    const audit = (calls.audit as { data: { action: string; before: { practiceLessonId: string }; after: { practiceLessonId: string } } }).data;
    expect(audit.action).toBe("followup.repeat");
    expect(audit.before.practiceLessonId).toBe("practice");
    expect(audit.after.practiceLessonId).toBe(calls.lessons[0].id);
  });

  it("moves the student to a control of his own when classmates share the draft control", async () => {
    const { tx, calls } = fakeTx({ classmates: 2 });
    const done = await repeatStage(tx as never, user as never, request, link as never, "practice");
    expect(done.ok && done.controlLessonId).not.toBe("control");
    expect(calls.deleted).toEqual([{ where: { lessonId: "control", studentId: "s1" } }]);
    expect(calls.lessons.map((l) => l.settings)).toEqual([{ hints: true }, { hints: false }]);
    expect(calls.seats[1]).toEqual(expect.objectContaining({ scenarioIds: ["c"] }));
  });
});
