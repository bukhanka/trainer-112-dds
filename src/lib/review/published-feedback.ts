/** A small, teacher-published learning note. Never copy an AI draft into this record implicitly. */
import { createHash } from "node:crypto";
import { z } from "zod";
import { reviewDigest } from "@/lib/followup/skills";
import { errorTitle } from "@/lib/scoring/errors";
import { applyOverrides, type CriterionResult, type Overrides, type WeightGroup } from "@/lib/scoring/score";

export const feedbackApprovalSchema = z.object({
  /** Binds text the teacher saw to the current criteria and draft, including a late regenerated draft. */
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  summary: z.string().trim().min(1).max(500),
  nextAction: z.string().trim().max(500).optional(),
  priorityCode: z.string().trim().min(1).max(160).optional(),
});
export type FeedbackApproval = z.infer<typeof feedbackApprovalSchema>;

const prioritySchema = z.object({
  code: z.string(),
  title: z.string(),
  critical: z.boolean(),
  evidence: z.string().nullable(),
  nextAction: z.string(),
});

const publishedSchema = z.object({
  version: z.literal(1),
  summary: z.string(),
  strength: z.string().nullable(),
  priority: prioritySchema.nullable(),
  source: z.enum(["rules", "teacher"]),
  reviewDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type PublishedFeedback = z.infer<typeof publishedSchema>;

/** The token sent with an explicit text approval; any new draft or new checks invalidate it. */
export function feedbackRevision(criteria: CriterionResult[], draft: unknown): string {
  return createHash("sha256").update(JSON.stringify([criteria, draft ?? null])).digest("hex");
}

const nextByGroup: Record<WeightGroup, string> = {
  timeliness: "Следите за временем каждого этапа и начинайте оформление без задержки.",
  statusOrder: "После доклада сверьте сообщённый этап работ с выбранным статусом.",
  comments: "Запишите причину и итог передачи так, чтобы следующий диспетчер понял решение.",
  address: "Переспросите недостающие части адреса и сверьте запись со словами заявителя.",
  services: "Сопоставьте тип происшествия с тем, какие службы нужно оповестить.",
  completeness: "Пройдите обязательные вопросы и заполните поля по полученным ответам.",
  literacy: "Запишите, кто, что, где и что сделано, без непонятных сокращений.",
};

function short(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.slice(0, 500) : null;
}

/** Only effective failed checks can become the priority. Null means not applicable, not an error. */
export function buildPublishedFeedback(input: {
  criteria: CriterionResult[];
  override: Overrides | null;
  teacherComment: string | null;
  reviewedAt: Date;
  approval?: FeedbackApproval;
}): PublishedFeedback {
  const effective = applyOverrides(input.criteria, input.override);
  const failures = effective.filter((c) => c.ok === false);
  const selected = input.approval?.priorityCode
    ? failures.find((c) => c.code === input.approval?.priorityCode)
    : failures.find((c) => c.critical) ?? failures[0];
  if (input.approval?.priorityCode && !selected) throw new Error("Выбранная ошибка больше не подтверждена — обновите страницу");
  const passed = effective.find((c) => c.ok === true);
  const summary = input.approval?.summary ?? (selected
    ? `Преподаватель проверил работу. Главное замечание: ${errorTitle(selected)}.`
    : passed
      ? "Преподаватель проверил работу. Применимые проверки пройдены."
      : "Проверка завершена. Данных для оценки отдельных действий недостаточно.");
  const nextAction = input.approval?.nextAction || (selected && short(selected.expected)) || (selected && nextByGroup[selected.group]) || "";
  return {
    version: 1,
    summary,
    strength: passed?.title ?? null,
    priority: selected ? { code: selected.code, title: errorTitle(selected), critical: Boolean(selected.critical), evidence: short(selected.evidence), nextAction } : null,
    source: input.approval ? "teacher" : "rules",
    reviewDigest: reviewDigest({ criteria: input.criteria, override: input.override, reviewedAt: input.reviewedAt, teacherComment: input.teacherComment }),
  };
}

/** Whitelist fields: malformed or older JSON cannot inject a model draft into the student DTO. */
export function readPublishedFeedback(raw: unknown): PublishedFeedback | null {
  return publishedSchema.safeParse(raw).data ?? null;
}
