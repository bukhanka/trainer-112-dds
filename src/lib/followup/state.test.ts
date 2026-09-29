import { describe, expect, it } from "vitest";
import { readCriteria } from "@/lib/review/draft";
import { goalOutcome, reviewDigest, SKILLS } from "./skills";
import { canIssueControl, followUpStartProblem, followUpState, sourceIsCurrent } from "./state";
import type { CriterionResult } from "@/lib/scoring/score";

const at = new Date("2026-09-28T12:00:00Z");
const criterion = (code: string, ok: boolean | null, critical = false): CriterionResult => ({ code, ok, critical, title: code, group: "address", source: "rule" });
const source = { id: "source", studentId: "student", reviewStatus: "CONFIRMED", reviewedAt: at, reviewedById: "teacher", criteria: [criterion("op112.address.street", false)], override: null, teacherComment: "Переспросите улицу" };
const digest = reviewDigest({ criteria: readCriteria(source.criteria), override: null, reviewedAt: at, teacherComment: source.teacherComment });
const practice = { id: "practice", status: "FINISHED", seats: [{ studentId: "student", scenarioIds: ["scenario-practice"] }] };
const control = { id: "control", status: "DRAFT", seats: [{ studentId: "student", scenarioIds: ["scenario-control"] }] };
const link = { id: "follow", sourceAttemptId: source.id, sourceAttempt: source, sourceReviewDigest: digest,
  practiceLessonId: practice.id, practiceLesson: practice, controlLessonId: control.id, controlLesson: control,
  skillKey: "op112.location", sourceSnapshot: { practiceScenarioId: "scenario-practice", controlScenarioId: "scenario-control" },
  cancelledAt: null, controlJudgment: null };
const checks = SKILLS["op112.location"].required.map((code) => criterion(code, true));
const attempt = { id: "done", lessonId: practice.id, studentId: source.studentId, scenarioId: "scenario-practice", reviewStatus: "CONFIRMED", reviewedAt: at, criteria: checks, override: null, teacherComment: null };
const client = (attempts: typeof attempt[]) => ({ attempt: { findMany: async () => attempts } });

// The production functions receive a Prisma client. These tests supply only the read methods they call.
type Db = Parameters<typeof followUpState>[0];
type Link = Parameters<typeof followUpState>[1];

describe("follow-up state and control gate", () => {
  it("does not progress without a checked attempt, or after the source review changes", async () => {
    // A finished practice without the student's attempt has nothing to review: the teacher repeats it or cancels.
    expect(await followUpState(client([]) as unknown as Db, link as unknown as Link)).toBe("practice_missed");
    expect(await followUpState(client([{ ...attempt, reviewStatus: "PENDING" }]) as unknown as Db, link as unknown as Link)).toBe("review_practice");
    expect(await followUpState(client([attempt]) as unknown as Db, link as unknown as Link)).toBe("control_ready");
    const changed = { ...link, sourceAttempt: { ...source, teacherComment: "Изменил решение" } };
    expect(sourceIsCurrent(changed as unknown as Link)).toBe(false);
    expect(await followUpState(client([attempt]) as unknown as Db, changed as unknown as Link)).toBe("source_changed");
  });

  it("needs a teacher-observed action as well as correct card fields", () => {
    expect(goalOutcome("op112.location", checks, null)).toBe("insufficient");
    expect(goalOutcome("op112.location", checks, {
      attemptId: "control-attempt", reviewDigest: "a".repeat(64), observed: false, evidence: "Оператор угадал место до уточнения", reviewedById: "teacher", reviewedAt: at.toISOString(),
    })).toBe("failed");
  });

  it("stops releasing control after a source or practice review is reopened", async () => {
    const active = { ...link, controlLesson: { ...control, status: "RUNNING" } };
    const dbFor = (row: typeof active, practiceAttempt: typeof attempt) => ({
      followUp: { findMany: async () => [row] },
      attempt: { findMany: async () => [practiceAttempt] },
    });
    expect(await canIssueControl(dbFor(active, attempt) as unknown as Db, "control", "student", "scenario-control")).toBe(true);
    const reopenedSource = { ...active, sourceAttempt: { ...source, reviewStatus: "PENDING" } };
    expect(await canIssueControl(dbFor(reopenedSource, attempt) as unknown as Db, "control", "student", "scenario-control")).toBe(false);
    const reopenedPractice = { ...attempt, reviewStatus: "PENDING" };
    expect(await canIssueControl(dbFor(active, reopenedPractice) as unknown as Db, "control", "student", "scenario-control")).toBe(false);
  });

  it("does not bypass the control gate when a linked scenario loses its metadata", async () => {
    const fake = {
      followUp: { findMany: async () => [link] },
      scenario: { findMany: async () => [{ id: "scenario-control", learningMeta: null }], findUnique: async () => ({ id: "scenario-control", status: "APPROVED" }) },
    };
    expect(await followUpStartProblem(fake as unknown as Db, "control", ["scenario-control"])).toMatch(/Сценарий изменился/);
  });

  it("does not allow an ordinary lesson to start a reserved control case", async () => {
    const fake = {
      scenario: { findMany: async () => [{ id: "hidden", learningMeta: { purpose: "control", role: "OP112", skillKeys: ["op112.location"], equivalenceKey: "address-5", caseKey: "hidden" } }] },
      followUp: { findMany: async () => [] },
    };
    expect(await followUpStartProblem(fake as unknown as Db, "copied-lesson", ["hidden"])).toMatch(/только из действующей отработки/);
  });
});

describe("after the control", () => {
  const finished = { ...link, controlLesson: { ...control, status: "FINISHED" } };
  const controlAttempt = { ...attempt, id: "control-attempt", lessonId: control.id, scenarioId: "scenario-control" };
  const both = (rows: typeof attempt[]) => ({ attempt: { findMany: async ({ where }: { where: { lessonId: string } }) => rows.filter((a) => a.lessonId === where.lessonId) } });

  it("a missed control is not «ждёт проверки»", async () => {
    expect(await followUpState(both([attempt]) as unknown as Db, finished as unknown as Link)).toBe("control_missed");
  });

  it("passed checks wait for the teacher's observation, and only that confirms the goal", async () => {
    expect(await followUpState(both([attempt, controlAttempt]) as unknown as Db, finished as unknown as Link)).toBe("observe_control");
    const judged = { ...finished, controlJudgment: {
      attemptId: controlAttempt.id, reviewDigest: reviewDigest({ criteria: readCriteria(controlAttempt.criteria), override: null, reviewedAt: at, teacherComment: null }),
      observed: true, evidence: "Сам спросил номер дома и записал ответ", reviewedById: "teacher", reviewedAt: at.toISOString() } };
    expect(await followUpState(both([attempt, controlAttempt]) as unknown as Db, judged as unknown as Link)).toBe("achieved");
    // An observation of the practice alone never counts as the goal.
    const practiceOnly = { ...finished, practiceJudgment: judged.controlJudgment };
    expect(await followUpState(both([attempt, controlAttempt]) as unknown as Db, practiceOnly as unknown as Link)).toBe("observe_control");
  });
});

describe("starting the control of a class", () => {
  const student = (id: string, name: string, practiceStatus: string, attempts: typeof attempt[]) => ({
    row: { ...link, id: `follow-${id}`, sourceAttempt: { ...source, studentId: id, student: { fullName: name } },
      practiceLesson: { ...practice, seats: [{ studentId: id, scenarioIds: ["scenario-practice"] }], status: practiceStatus },
      controlLesson: { ...control, seats: [{ studentId: id, scenarioIds: ["scenario-control"] }] },
      sourceSnapshot: { ...link.sourceSnapshot, controlDigest: "d" } },
    attempts: attempts.map((a) => ({ ...a, studentId: id })),
  });
  const scenario = { id: "scenario-control", status: "APPROVED", ticketRef: "Б11-1", learningMeta: null, caller: null, truth: null, ddsCard: null, ddsReference: null };
  const fake = (rows: ReturnType<typeof student>[], heard: string[] = []) => ({
    followUp: { findMany: async () => rows.map((r) => r.row) },
    scenario: {
      findMany: async ({ where }: { where: { id: { in: string[] } } }) => (where.id.in.includes("scenario-control") ? [scenario] : heard.map((id) => ({ id, ticketRef: "Б11-1", learningMeta: null }))),
      findUnique: async () => scenario,
    },
    attempt: { findMany: async ({ where }: { where: { studentId: string | { in: string[] } } }) => rows.flatMap((r) => r.attempts).filter((a) => typeof where.studentId === "string" ? a.studentId === where.studentId : true) },
    seat: { findMany: async () => heard.length ? [{ id: "seat-x", studentId: "s2" }] : [] },
    incident: { findMany: async () => heard.map((id) => ({ scenarioId: id, createdBySeatId: "seat-x", ddsSeatId: null })) },
    call: { findMany: async () => [] },
  });

  it("names who is not ready and what to do, instead of a general refusal", async () => {
    const digestOk = (await import("./skills")).scenarioDigest(scenario);
    const rows = [student("s1", "Кузнецов Дмитрий Андреевич", "FINISHED", []), student("s2", "Иванов Алексей Сергеевич", "FINISHED", [attempt])];
    for (const r of rows) r.row.sourceSnapshot = { ...r.row.sourceSnapshot, controlDigest: digestOk };
    const problem = await followUpStartProblem(fake(rows) as unknown as Db, "control", ["scenario-control"]);
    expect(problem).toMatch(/Кузнецов Д\. А\.: отработка завершена без попытки ученика — нажмите «Повторить отработку»/);
    expect(problem).not.toMatch(/Иванов/);
  });

  it("checks again that the control is new: a case met since the assignment blocks it with the name", async () => {
    const digestOk = (await import("./skills")).scenarioDigest(scenario);
    const rows = [student("s2", "Иванов Алексей Сергеевич", "FINISHED", [attempt])];
    rows[0].row.sourceSnapshot = { ...rows[0].row.sourceSnapshot, controlDigest: digestOk };
    expect(await followUpStartProblem(fake(rows) as unknown as Db, "control", ["scenario-control"])).toBeNull();
    expect(await followUpStartProblem(fake(rows, ["other-copy"]) as unknown as Db, "control", ["scenario-control"])).toMatch(/Иванов А\. С\.: контрольную ситуацию ученик уже встретил/);
  });
});
