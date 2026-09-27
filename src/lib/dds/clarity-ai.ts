/**
 * The model's check of the ДДС comments: would the next dispatcher understand them without a phone call?
 *
 * It runs after the rules (clarity.ts) and in the background, so the rule verdicts never wait for it. The
 * model is shown the relevant teacher corrections of this check (src/lib/review/corrections.ts) and decides
 * similar cases the way the teacher did. Without a model, or when it fails, the check is «не применимо» and
 * does not count. The quote it returns is kept only if it really is in the comments.
 */
import { createHash } from "node:crypto";
import { z } from "zod";
import { aiOffNote, chatJson, llmConfigured, type ChatMessage } from "@/lib/ai/provider";
import { guidanceText, type CorrectionContext, type GuidanceRow } from "@/lib/review/corrections";
import type { CriterionResult } from "@/lib/scoring/score";
import type { JudgedComment } from "./clarity";
import { STATUS_LABEL } from "./status";

export const CLARITY_AI_CODE = "dds.ai.literacy";
const TITLE = "ИИ: комментарии понятны следующему диспетчеру";

export type ClarityAiInput = {
  service: string;
  /** What the card says: type, address, description — the context the next dispatcher also has. */
  card: string;
  comments: JudgedComment[];
};

/** Fingerprint of the judged text: the same comments are not sent to the model twice. */
export function clarityBasis(comments: JudgedComment[]): string {
  return createHash("sha256")
    .update(JSON.stringify(comments.map((c) => [c.status, c.text.trim()])))
    .digest("hex")
    .slice(0, 16);
}

export function clarityAiUnavailable(reason: string, basis?: string): CriterionResult {
  return { code: CLARITY_AI_CODE, group: "literacy", title: TITLE, ok: null, evidence: reason, source: "ai", basis };
}

const replySchema = z.object({
  clear: z.boolean(),
  fragment: z.string().default(""),
  better: z.string().default(""),
});

export function clarityAiMessages(input: ClarityAiInput, ctx: CorrectionContext, guidance: GuidanceRow[]): ChatMessage[] {
  const lessons = guidanceText(ctx, guidance);
  const system = [
    "Ты — наставник дежурно-диспетчерских служб (ДДС) Москвы и разбираешь учебную работу диспетчера на тренажёре.",
    "Следующий диспетчер прочитает эти комментарии в карточке происшествия. Он должен понять без звонка: что сделано, чем закончилось, кому и почему передано.",
    "Непонятно: свои сокращения и обрывки слов, пропущенный итог, неясные «туда», «он», «как обычно», перепутанный порядок, слова в английской раскладке.",
    "Опечатки, которые не мешают понять смысл, ошибкой не считай. Общепринятые сокращения (ДДС, МЧС, ЦЭМП, ГБУ, ЖКХ, округа Москвы) допустимы.",
    'Верни только JSON: {"clear": true или false, "fragment": "точная цитата самого непонятного места или пустая строка", "better": "как написать понятнее — одно предложение"}.',
    ...(lessons ? ["", lessons] : []),
  ];
  const user = [
    `Служба: ${input.service}`,
    `Карточка: ${input.card || "—"}`,
    "Комментарии диспетчера:",
    ...input.comments.map((c) => `— ${STATUS_LABEL[c.status]}: «${c.text || "(пусто)"}»`),
  ];
  return [
    { role: "system", content: system.join("\n") },
    { role: "user", content: user.join("\n") },
  ];
}

const squash = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/[«»"]/g, "").replace(/\s+/g, " ").trim();

/** Turns the model's reply into the check; a quote that is not in the comments is dropped. */
export function clarityFromReply(reply: z.infer<typeof replySchema>, input: ClarityAiInput, guidance: GuidanceRow[], basis: string): CriterionResult {
  const fragment = reply.fragment.trim();
  const quoted = fragment && input.comments.some((c) => squash(c.text).includes(squash(fragment))) ? fragment : "";
  const better = reply.better.trim();
  return {
    code: CLARITY_AI_CODE,
    group: "literacy",
    title: TITLE,
    ok: reply.clear,
    evidence: reply.clear ? "Понятно без звонка" : quoted ? `Непонятно: «${quoted}»` : "Без звонка не понять, что сделано и чем закончилось",
    expected: reply.clear ? undefined : better || "Полными фразами: что сделано, чем закончилось, кому передано",
    source: "ai",
    learned: guidance.map((g) => g.id),
    basis,
  };
}

/** The model's verdict. Never throws: no comments, no model or a failure give «не применимо». */
export async function evaluateDdsClarityAi(input: ClarityAiInput, ctx: CorrectionContext, guidance: GuidanceRow[]): Promise<CriterionResult> {
  const basis = clarityBasis(input.comments);
  if (!input.comments.length) return clarityAiUnavailable("Комментариев для проверки нет", basis);
  if (!llmConfigured()) return clarityAiUnavailable(`ИИ-проверка не выполнялась: ${aiOffNote()}`, basis);
  try {
    const reply = await chatJson(clarityAiMessages(input, ctx, guidance), replySchema, { temperature: 0, maxTokens: 400 });
    return clarityFromReply(reply, input, guidance, basis);
  } catch (err) {
    return clarityAiUnavailable(`ИИ-проверка не удалась: ${err instanceof Error ? err.message.slice(0, 120) : "ошибка"}`, basis);
  }
}
