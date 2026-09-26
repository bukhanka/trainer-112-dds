/**
 * Teacher's decision on an attempt. Pure: the route handler loads the attempt, calls planReview and
 * writes the result together with an audit record (who, when, before, after).
 *
 *   confirm  — «Верно»: the draft is right, the attempt counts with the checks as they are;
 *   override — «ИИ неправ»: the teacher flips checks; only real changes are stored;
 *   reopen   — back to «на проверке» (for example after a mistaken click).
 */
import { z } from "zod";
import { computeScore, type CriterionResult, type Overrides, type Weights } from "@/lib/scoring/score";

export const RUNNING_LOCK = "Занятие ещё идёт: оценки подтверждаются после его окончания, чтобы ничего не менялось посреди работы класса.";

export const reviewActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), comment: z.string().trim().max(2000).optional() }),
  z.object({
    action: z.literal("override"),
    override: z.record(z.string(), z.boolean().nullable()),
    comment: z.string().trim().max(2000).optional(),
  }),
  z.object({ action: z.literal("reopen") }),
]);

export type ReviewAction = z.infer<typeof reviewActionSchema>;

export type ReviewState = {
  reviewStatus: "PENDING" | "CONFIRMED" | "OVERRIDDEN";
  override: Overrides | null;
  score: number | null;
  teacherComment: string | null;
};

export type ReviewPlan =
  | { ok: true; next: ReviewState; auditAction: string; changed: string[] }
  | { ok: false; error: string };

export function planReview(criteria: CriterionResult[], current: ReviewState, action: ReviewAction, weights: Weights): ReviewPlan {
  if (action.action === "reopen") {
    if (current.reviewStatus === "PENDING") return { ok: false, error: "Попытка и так на проверке" };
    return {
      ok: true,
      auditAction: "attempt.reopen",
      changed: [],
      next: { reviewStatus: "PENDING", override: current.override, score: computeScore(criteria, weights, current.override), teacherComment: current.teacherComment },
    };
  }

  if (action.action === "confirm") {
    return {
      ok: true,
      auditAction: "attempt.confirm",
      changed: [],
      next: {
        reviewStatus: "CONFIRMED",
        override: null,
        score: computeScore(criteria, weights, null),
        teacherComment: action.comment || null,
      },
    };
  }

  const byCode = new Map(criteria.map((c) => [c.code, c]));
  const unknown = Object.keys(action.override).filter((code) => !byCode.has(code));
  if (unknown.length) return { ok: false, error: "Проверка не найдена — обновите страницу" };
  // Keep only verdicts that differ from the draft: the stored override is exactly «what the teacher changed».
  const override: Overrides = {};
  for (const [code, verdict] of Object.entries(action.override)) {
    if (byCode.get(code)!.ok !== verdict) override[code] = verdict;
  }
  const changed = Object.keys(override);
  if (!changed.length) return { ok: false, error: "Вы не изменили ни одной проверки. Если черновик верен — нажмите «Верно»." };
  if (!action.comment) return { ok: false, error: "Напишите комментарий: как надо было и почему ИИ неправ" };
  return {
    ok: true,
    auditAction: "attempt.override",
    changed,
    next: { reviewStatus: "OVERRIDDEN", override, score: computeScore(criteria, weights, override), teacherComment: action.comment },
  };
}
