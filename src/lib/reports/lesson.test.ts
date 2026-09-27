import { describe, expect, it } from "vitest";
import type { CriterionResult } from "@/lib/scoring/score";
import { buildLessonReport, readiness, type ReportAttempt, type ReportInput } from "./lesson";

const c = (code: string, group: CriterionResult["group"], ok: boolean | null, extra: Partial<CriterionResult> = {}): CriterionResult => ({
  code,
  group,
  title: code,
  ok,
  source: "rule",
  ...extra,
});

let n = 0;
const attempt = (seatId: string, studentId: string, criteria: CriterionResult[], extra: Partial<ReportAttempt> = {}): ReportAttempt => ({
  id: `a${++n}`,
  seatId,
  studentId,
  kind: "DDS",
  reviewStatus: "CONFIRMED",
  score: 50,
  criteria,
  override: null,
  timeSec: 20,
  actions: 3,
  incidentNumber: 1,
  scenarioTitle: "Задание",
  createdAt: new Date("2026-09-25T07:00:00Z"),
  teacherComment: null,
  ...extra,
});

const input = (attempts: ReportAttempt[]): ReportInput => ({
  norms: { ackSec: 30, typingSec: 65 },
  seats: [
    { id: "s1", label: "Место 1", role: "DDS", studentId: "u1", studentName: "Иванов А. С.", serviceName: "Поселение Вороновское" },
    { id: "s2", label: "Место 2", role: "DDS", studentId: "u2", studentName: "Петрова М. И.", serviceName: "Поселение Вороновское" },
    { id: "s3", label: "Место 3", role: "OP112", studentId: "u3", studentName: "Кузнецов Д. А.", serviceName: null },
  ],
  attempts,
});

describe("buildLessonReport", () => {
  const report = buildLessonReport(
    input([
      attempt("s1", "u1", [c("ack", "timeliness", true), c("comment", "comments", true)], { score: 100, timeSec: 18 }),
      attempt("s2", "u2", [c("ack", "timeliness", false), c("comment", "comments", false), c("text", "literacy", false)], { score: 20, timeSec: 50 }),
      attempt("s2", "u2", [c("ack", "timeliness", false), c("comment", "comments", true)], { score: 60, timeSec: 42 }),
      attempt("s3", "u3", [c("street", "address", false, { critical: true }), c("text", "literacy", false, { source: "ai" })], {
        kind: "OP112",
        score: 30,
        timeSec: 70,
        override: { text: true },
      }),
      attempt("s3", "u3", [c("street", "address", false)], { kind: "OP112", reviewStatus: "PENDING", score: 0 }),
    ]),
  );

  it("exports only confirmed attempts, never draft verdicts", () => {
    expect(report.attempts).toHaveLength(4);
    expect(report.attempts.every((a) => a.reviewStatus !== "PENDING")).toBe(true);
  });

  it("counts only confirmed attempts", () => {
    expect(report.summary).toMatchObject({ reviewed: 4, pending: 1, avgScore: 53 });
    const kuz = report.students.find((s) => s.studentId === "u3")!;
    expect(kuz).toMatchObject({ reviewed: 1, pending: 1, errors: 1, critical: 1, textErrors: 0 });
  });

  it("compares time with the norm of the place", () => {
    const pet = report.students.find((s) => s.studentId === "u2")!;
    expect(pet).toMatchObject({ avgTimeSec: 46, normSec: 30, deltaSec: 16, lateCount: 2, textErrors: 1, actions: 6 });
    const kuz = report.students.find((s) => s.studentId === "u3")!;
    expect(kuz).toMatchObject({ normSec: 65, deltaSec: 5, timeLabel: "набор карточки" });
  });

  it("names leaders and laggards with reasons", () => {
    expect(report.leaders.map((l) => l.row.studentId)).toEqual(["u1", "u2"]);
    expect(report.leaders[0].why).toContain("ни одной ошибки");
    expect(report.laggards.map((l) => l.row.studentId)).toEqual(["u3"]);
    expect(report.laggards[0].why).toContain("критичных ошибок: 1");
  });

  it("finds the typical errors of the group", () => {
    expect(report.typical[0]).toMatchObject({ code: "ack", failed: 2, applicable: 3, rate: 67 });
    expect(report.insight).toContain("«Не выполнено: ack» — 2 из 3");
  });

  it("measures how often the teacher agreed with the draft", () => {
    // 9 checks in confirmed attempts, one AI check flipped by the teacher
    expect(report.summary.agreement).toEqual({ checks: 9, changed: 1, rate: 89, aiChecks: 1, aiChanged: 1 });
  });

  it("builds a heat map only over groups that were checked", () => {
    expect(report.heat.groups).toEqual(["timeliness", "comments", "address", "literacy"]);
    const pet = report.heat.rows.find((r) => r.studentId === "u2")!;
    expect(pet.cells.find((x) => x.group === "timeliness")).toMatchObject({ failed: 2, applicable: 2, rate: 100 });
    expect(pet.cells.find((x) => x.group === "address")?.rate).toBeNull();
  });
});

describe("typical errors are counted by the error, not by the code", () => {
  it("does not lend one attempt's time to another or merge different questions", () => {
    const op = { kind: "OP112" as const };
    const report = buildLessonReport(
      input([
        attempt("s3", "u3", [c("op112.typing_time", "timeliness", false, { title: "Карточка сохранена за 3:44" }), c("op112.question.1", "completeness", true, { title: "Задан вопрос: В сознании ли, дышит ли" })], op),
        attempt("s3", "u3", [c("op112.typing_time", "timeliness", false, { title: "Карточка сохранена за 2:01" }), c("op112.question.1", "completeness", false, { title: "Задан вопрос: Есть ли угроза людям" })], op),
      ]),
    );
    expect(report.typical.map((t) => [t.title, t.failed, t.applicable])).toEqual([
      ["Карточка набрана дольше норматива", 2, 2],
      ["Не задан вопрос: Есть ли угроза людям", 1, 1],
    ]);
    expect(report.insight).not.toContain("3:44");
    expect(report.attempts[1].failedTitles).toEqual(["Карточка набрана дольше норматива", "Не задан вопрос: Есть ли угроза людям"]);
  });
});

describe("pass criteria in the report", () => {
  const attempts = [
    attempt("s1", "u1", [c("ack", "timeliness", true)], { score: 100 }),
    attempt("s2", "u2", [c("ack", "timeliness", false)], { score: 60 }),
    attempt("s2", "u2", [c("street", "address", false, { critical: true }), c("ack", "timeliness", true)], { score: 80 }),
    attempt("s3", "u3", [c("ack", "timeliness", true)], { kind: "OP112", reviewStatus: "PENDING", score: 90 }),
  ];

  it("counts «зачтено» over confirmed attempts by the lesson's criteria", () => {
    const report = buildLessonReport({ ...input(attempts), pass: { passScore: 70, maxCritical: 0 } });
    expect(report.summary).toMatchObject({ passed: 1, judged: 3 });
    expect(report.students.find((s) => s.studentId === "u2")).toMatchObject({ passed: 0, judged: 2 });
    expect(report.students.find((s) => s.studentId === "u3")).toMatchObject({ passed: 0, judged: 0 });
    const reasons = report.attempts.filter((a) => a.studentId === "u2").map((a) => a.pass?.reasons);
    expect(reasons).toEqual([["балл 60 ниже 70"], ["критичная ошибка: «Не выполнено: street»"]]);
  });

  it("follows other criteria and defaults to 70 without a critical error", () => {
    expect(buildLessonReport({ ...input(attempts), pass: { passScore: 60, maxCritical: 1 } }).summary).toMatchObject({ passed: 3, judged: 3 });
    const report = buildLessonReport(input(attempts));
    expect(report.pass).toEqual({ passScore: 70, maxCritical: 0 });
    expect(report.summary.passed).toBe(1);
  });
});

describe("readiness", () => {
  it("maps the average score to a level", () => {
    expect(readiness(90)?.label).toMatch(/готов/);
    expect(readiness(49)?.tone).toBe("red");
    expect(readiness(null)).toBeNull();
  });
});
