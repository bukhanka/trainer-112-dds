import { describe, expect, it } from "vitest";
import { toHistoryAttempt } from "@/lib/adaptive/history";
import { buildLessonReport } from "@/lib/reports/lesson";
import { passVerdict } from "@/lib/scoring/pass";
import { computeScore, type CriterionResult, type Weights } from "@/lib/scoring/score";
import { typingTimeCheck } from "./typing-time";

const WEIGHTS: Weights = { timeliness: 3, statusOrder: 2, comments: 2, address: 3, services: 3, completeness: 1, literacy: 1, timeZeroAt: 2 };
const rest = (ok = true): CriterionResult[] =>
  (["address", "services", "completeness", "literacy"] as const).map((group) => ({ code: `${group}.x`, group, title: group, ok, source: "rule" }));

describe("smooth time points stay consistent with the rest of the grading", () => {
  it("pass criteria follow the new score: a slow but right card still passes, a slow card with errors does not", () => {
    const rules = { passScore: 70, maxCritical: 0 };
    const slow = [typingTimeCheck("Карточка сохранена", 195, 65), ...rest()];
    expect(passVerdict(computeScore(slow, WEIGHTS), slow, null, rules)).toEqual({ passed: true, reasons: [] });
    // Late and a missed field: the partial points decide — 1:20 passes, 2:10 does not.
    const withError = (sec: number) => [typingTimeCheck("Карточка сохранена", sec, 65), ...rest(), { code: "c2", group: "completeness", title: "ФИО", ok: false, source: "rule" } as CriterionResult];
    expect(passVerdict(computeScore(withError(80), WEIGHTS), withError(80), null, rules)?.passed).toBe(true);
    expect(passVerdict(computeScore(withError(130), WEIGHTS), withError(130), null, rules)?.reasons).toEqual(["балл 68 ниже 70"]);
  });

  it("a late card is still «не в нормативе» in the report and the forecast, whatever its points", () => {
    const check = typingTimeCheck("Карточка сохранена", 66, 65);
    expect(check.ok).toBe(false);
    const opened = new Date("2026-09-28T10:00:00Z");
    const saved = new Date(opened.getTime() + 66_000);
    // The forecast and the reaction time read the same seconds and the same norm from the incident and the lesson.
    const history = toHistoryAttempt({
      id: "a1",
      studentId: "s1",
      lessonId: "l1",
      kind: "OP112",
      score: 100,
      reviewStatus: "CONFIRMED",
      createdAt: saved,
      reviewedAt: saved,
      lesson: { title: "Занятие", startedAt: opened, settings: { typingSec: 65 } },
      scenario: { difficulty: 3 },
      incident: { createdAt: opened, openedAt: opened, savedAt: saved },
      incidentService: null,
    } as unknown as Parameters<typeof toHistoryAttempt>[0]);
    expect({ sec: history.timeSec, normSec: history.normSec }).toEqual(check.timing);
    // The lesson report counts it late and as an error of the time group, with the error named without the time.
    const report = buildLessonReport({
      seats: [{ id: "seat", studentId: "s1", studentName: "Иванов Алексей", label: "Место 1", role: "OP112", serviceName: null }],
      attempts: [
        {
          id: "a1",
          seatId: "seat",
          studentId: "s1",
          kind: "OP112",
          reviewStatus: "CONFIRMED",
          score: computeScore([check, ...rest()], WEIGHTS),
          criteria: [check, ...rest()],
          override: null,
          timeSec: 66,
          actions: 0,
        },
      ],
      norms: { ackSec: 30, typingSec: 65 },
    } as unknown as Parameters<typeof buildLessonReport>[0]);
    expect(report.students[0]).toMatchObject({ lateCount: 1, avgScore: 100 });
    expect(report.typical.map((t) => t.title)).toEqual(["Карточка набрана дольше норматива"]);
  });
});
