import { describe, expect, it } from "vitest";
import { planBulkConfirm } from "./bulk";
import { feedbackRevision, buildPublishedFeedback, readPublishedFeedback } from "./published-feedback";
import { planReview, type ReviewState } from "./review";
import type { CriterionResult } from "@/lib/scoring/score";
import { DEFAULT_WEIGHTS } from "@/lib/scoring/weight-config";

const at = new Date("2026-09-28T12:00:00.000Z");
const criteria: CriterionResult[] = [
  { code: "street", group: "address", title: "Улица записана верно", ok: false, critical: true, evidence: "Оператор записал другую улицу", expected: "Переспросить название улицы", source: "rule" },
  { code: "time", group: "timeliness", title: "Время", ok: null, critical: true, source: "rule" },
  { code: "note", group: "literacy", title: "Понятная запись", ok: false, source: "ai" },
  { code: "house", group: "address", title: "Дом записан верно", ok: true, source: "rule" },
];
const pending: ReviewState = { reviewStatus: "PENDING", override: null, score: null, teacherComment: null };

describe("published learner feedback", () => {
  it("publishes the same deterministic note from single and bulk confirmation without copying AI text", () => {
    const single = planReview(criteria, pending, { action: "confirm" }, DEFAULT_WEIGHTS);
    const bulk = planBulkConfirm(["a"], [{ id: "a", reviewStatus: "PENDING", criteria, override: null, teacherComment: null }], false);
    expect(single.ok).toBe(true);
    expect(bulk.confirm).toHaveLength(1);
    if (!single.ok) return;
    const direct = buildPublishedFeedback({ criteria, override: single.next.override, teacherComment: single.next.teacherComment, reviewedAt: at });
    const batch = buildPublishedFeedback({ criteria: bulk.confirm[0].criteria, override: null, teacherComment: null, reviewedAt: at });
    expect(direct).toEqual(batch);
    expect(direct.priority).toMatchObject({ code: "street", critical: true, evidence: "Оператор записал другую улицу", nextAction: "Переспросить название улицы" });
    expect(direct.source).toBe("rules");
    expect(JSON.stringify(direct)).not.toContain("SECRET_AI_DRAFT");
  });

  it("uses the teacher's effective verdict, so an overruled or non-applicable check is never a learner error", () => {
    const feedback = buildPublishedFeedback({ criteria, override: { street: true, note: null }, teacherComment: "ИИ ошибся", reviewedAt: at });
    expect(feedback.priority).toBeNull();
    expect(feedback.strength).toBe("Улица записана верно");
    const allNull = buildPublishedFeedback({ criteria: criteria.map((c) => ({ ...c, ok: null })), override: null, teacherComment: null, reviewedAt: at });
    expect(allNull.priority).toBeNull();
    expect(allNull.summary).toContain("недостаточно");
  });

  it("requires an exact draft revision for teacher-edited text and only allows a confirmed failed priority", () => {
    const oldDraft = { summary: "old" };
    const newDraft = { summary: "SECRET_AI_DRAFT" };
    expect(feedbackRevision(criteria, oldDraft)).not.toBe(feedbackRevision(criteria, newDraft));
    const approved = buildPublishedFeedback({
      criteria,
      override: null,
      teacherComment: null,
      reviewedAt: at,
      approval: { revision: feedbackRevision(criteria, oldDraft), summary: "Проверили адрес.", nextAction: "Уточните улицу вопросом.", priorityCode: "street" },
    });
    expect(approved.source).toBe("teacher");
    expect(approved.priority?.nextAction).toBe("Уточните улицу вопросом.");
    expect(() => buildPublishedFeedback({
      criteria,
      override: { street: true },
      teacherComment: null,
      reviewedAt: at,
      approval: { revision: feedbackRevision(criteria, oldDraft), summary: "x", priorityCode: "street" },
    })).toThrow(/больше не подтверждена/);
  });

  it("reads only whitelisted published fields, never appended draft or model details", () => {
    const saved = buildPublishedFeedback({ criteria, override: null, teacherComment: null, reviewedAt: at });
    const shown = readPublishedFeedback({ ...saved, aiDraft: "SECRET_AI_DRAFT", model: "secret-model", priority: { ...saved.priority, answerKey: "SECRET_ANSWER" } });
    expect(shown).toEqual(saved);
    expect(JSON.stringify(shown)).not.toContain("SECRET_");
    expect(readPublishedFeedback({ ...saved, version: 99 })).toBeNull();
  });
});
