/**
 * The AI draft of an attempt review (Attempt.aiDraft) and a rule-based fallback.
 *
 * The draft is advice for the teacher, never a verdict: a score counts only after the teacher
 * presses «Верно» or corrects the checks. Without a model the draft is assembled from the checks
 * themselves, so the teacher always sees a readable summary.
 */
import { z } from "zod";
import { applyOverrides, WEIGHT_GROUPS, type CriterionResult, type Overrides, type WeightGroup } from "@/lib/scoring/score";

export type AiDraft = {
  summary: string;
  comments?: Record<string, string>; // check code → comment
  recommendations?: string[];
  source?: "ai" | "rules";
  model?: string;
  createdAt?: string;
};

const draftSchema = z.object({
  summary: z.string().default(""),
  comments: z.record(z.string(), z.string()).optional(),
  recommendations: z.array(z.string()).optional(),
  source: z.enum(["ai", "rules"]).optional(),
  model: z.string().optional(),
  createdAt: z.string().optional(),
});

/** Other parts of the app may write richer drafts; read what we understand and ignore the rest. */
export function readDraft(raw: unknown): AiDraft | null {
  if (!raw || typeof raw !== "object") return null;
  const parsed = draftSchema.safeParse(raw);
  if (parsed.success && (parsed.data.summary || parsed.data.recommendations?.length)) return parsed.data;
  const text = (raw as { text?: unknown }).text;
  return typeof text === "string" && text ? { summary: text } : null;
}

const text = z.preprocess((v) => (v == null || v === "" ? undefined : typeof v === "string" ? v : JSON.stringify(v)), z.string().optional());

const criterionSchema = z.object({
  code: z.string().min(1),
  group: z.enum(Object.keys(WEIGHT_GROUPS) as [WeightGroup, ...WeightGroup[]]),
  title: z.string().min(1),
  ok: z.boolean().nullable(),
  critical: z.boolean().optional(),
  evidence: text,
  expected: text,
  source: z.enum(["rule", "ai"]).catch("rule"),
});

/** Attempt.criteria is JSON written by the workstations; skip anything malformed instead of crashing a page. */
export function readCriteria(raw: unknown): CriterionResult[] {
  if (!Array.isArray(raw)) return [];
  const out: CriterionResult[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    // Tolerate the older «key» spelling and a missing title.
    const code = row.code ?? row.key;
    const parsed = criterionSchema.safeParse({ ...row, code, title: row.title ?? code, ok: row.ok ?? null });
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

export function readOverrides(raw: unknown): Overrides | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out: Overrides = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === true || v === false || v === null) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}

/** Per-group advice for the student. Our own wording, based on the dispatcher memo and the customer's Q&A. */
export const GROUP_ADVICE: Record<WeightGroup, string> = {
  timeliness:
    "Следите за нормативами: ответ «Принята» / «Не принята» — в пределах 30 секунд после «Добавлена», обработка карточки — до 3 минут, карточку 112 сохраняйте до того, как покраснеет таймер.",
  statusOrder:
    "Ведите статусы по порядку: Принята → Начало реагирования → Прибытие → Проведение работ → Работы завершены. После каждого доклада бригады ставьте соответствующий статус.",
  comments:
    "К «Не принята» и «Отказ от выполнения работ» комментарий обязателен: причина и кому передано (организация, служба или номер карточки).",
  address:
    "Сверяйте адрес по буквам и переспрашивайте: похожие улицы (Дубнинская и Дубининская) отправляют бригаду не туда. Уточняйте дом, корпус, подъезд и ориентиры.",
  services:
    "Проверяйте тип происшествия и службы: они подбираются по типу и адресу. Отказ от профильного происшествия — ошибка, даже если реагирует другая служба.",
  completeness:
    "Заполняйте карточку полностью: заявитель и его статус, пострадавшие, обязательные вопросы опросной карты (например, газ магистральный или баллонный).",
  literacy: "Пишите так, чтобы следующий диспетчер понял без звонка: кто, что, где, что сделано. Без личных сокращений.",
};

/** Summary assembled from the checks, used when no model is configured or the model fails. */
export function ruleDraft(criteria: CriterionResult[], overrides?: Overrides | null): AiDraft {
  const list = applyOverrides(criteria, overrides);
  const failed = list.filter((c) => c.ok === false);
  const passed = list.filter((c) => c.ok === true);
  const critical = failed.filter((c) => c.critical);
  const parts: string[] = [];
  if (!failed.length) parts.push(passed.length ? `Все проверки пройдены (${passed.length}).` : "Проверок, которые можно применить, нет.");
  else {
    parts.push(`Ошибок: ${failed.length} из ${failed.length + passed.length}.`);
    if (critical.length) parts.push(`Критичная ошибка: ${critical.map((c) => `«${c.title}»`).join(", ")} — балл ограничен.`);
    parts.push(`Не выполнено: ${failed.slice(0, 3).map((c) => `«${c.title}»`).join(", ")}${failed.length > 3 ? " и другие" : ""}.`);
  }
  const comments: Record<string, string> = {};
  for (const c of failed) {
    comments[c.code] = [c.evidence, c.expected && `Правильно: ${c.expected}`].filter(Boolean).join(". ");
  }
  const groups = [...new Set(failed.map((c) => c.group))];
  return {
    summary: parts.join(" "),
    comments,
    recommendations: groups.map((g) => GROUP_ADVICE[g]),
    source: "rules",
    createdAt: new Date().toISOString(),
  };
}
