import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { followUpHistory, TEACHER_STATE } from "./teacher";

const row = {
  id: "f1", skillKey: "op112.location", createdAt: new Date("2026-09-29T00:53:00Z"), createdBy: { fullName: "Смирнова Ольга Петровна" },
  practiceJudgment: null, controlJudgment: null, cancellationReason: null,
};
const at = (m: number) => new Date(`2026-09-29T01:${String(m).padStart(2, "0")}:00Z`);

describe("history of an assignment for the teacher", () => {
  it("keeps the basis of every observation, the repeats and the cancellation, in time order", () => {
    const audits = [
      { at: at(20), action: "followup.observe", actorId: "t", entityId: "f1", before: null, after: { stage: "practice", attemptId: "a1", observed: true, evidence: "Спросил номер дома после подсказки" } },
      { at: at(10), action: "followup.repeat", actorId: "t", entityId: "f1", before: { practiceLessonId: "old" }, after: { stage: "practice", practiceLessonId: "new" } },
      { at: at(30), action: "followup.cancel", actorId: "t", entityId: "f1", before: null, after: { reason: "Ученик переведён" } },
      { at: at(40), action: "followup.observe", actorId: "t", entityId: "other", before: null, after: { stage: "control", observed: true, evidence: "чужое" } },
    ];
    const history = followUpHistory(row as never, audits, new Map(), new Map([["t", "Смирнова Ольга Петровна"]]), { title: "Неверно указаны дом, корпус или строение", critical: false, evidence: null, expected: null, advice: "" });
    expect(history.map((h) => h.text)).toEqual([
      "Назначена отработка «Уточнить и записать место происшествия» по замечанию «Неверно указаны дом, корпус или строение»",
      "Отработка назначена повторно: новое занятие",
      "Наблюдение по отработке: выполнил",
      "Назначение отменено",
    ]);
    expect(history[1].lessonId).toBe("new");
    expect(history[2].evidence).toBe("Спросил номер дома после подсказки");
    expect(history[3].evidence).toBe("Ученик переведён");
  });

  it("tells the teacher what to do at every stop, and never calls a practice a confirmed skill", () => {
    expect(TEACHER_STATE.practice_missed.next).toMatch(/Повторить отработку/);
    expect(TEACHER_STATE.control_missed.next).toMatch(/Повторить контроль/);
    expect(TEACHER_STATE.review_practice.status).not.toMatch(/подтвержд/);
    expect(TEACHER_STATE.control_ready.status).not.toMatch(/подтвержд|выполнена/);
  });
});
