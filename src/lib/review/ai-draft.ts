import { z } from "zod";
import { aiMode, chatJson } from "@/lib/ai/provider";
import { applyOverrides, type CriterionResult, type Overrides } from "@/lib/scoring/score";
import { ruleDraft, type AiDraft } from "./draft";

const replySchema = z.object({
  summary: z.string().min(1),
  comments: z.record(z.string(), z.string()).default({}),
  recommendations: z.array(z.string()).max(5).default([]),
});

const ROLE_NAME = { OP112: "оператор Системы 112", DDS: "диспетчер ДДС" } as const;

/**
 * Review draft for the teacher. The model only explains the verdicts of the checks in plain words;
 * it must not change them — the decision belongs to the teacher. Any failure falls back to the rules.
 */
export async function buildDraft(kind: "OP112" | "DDS", criteria: CriterionResult[], overrides: Overrides | null): Promise<AiDraft> {
  const fallback = ruleDraft(criteria, overrides);
  if (aiMode().llm === "mock" || !criteria.length) return fallback;
  const list = applyOverrides(criteria, overrides).map((c) => ({
    code: c.code,
    check: c.title,
    verdict: c.ok === null ? "не применимо" : c.ok ? "верно" : "ошибка",
    critical: Boolean(c.critical),
    evidence: c.evidence ?? "",
    expected: c.expected ?? "",
  }));
  try {
    const reply = await chatJson(
      [
        {
          role: "system",
          content:
            `Ты помощник преподавателя учебного центра. Обучающийся работал как ${ROLE_NAME[kind]}. ` +
            "Тебе дан список автоматических проверок с вердиктами и доказательствами. Вердикты не меняй и не оспаривай — решение принимает преподаватель. " +
            "Напиши по-русски, коротко и простыми словами: summary — 2–3 предложения об итогах; comments — для каждой ошибки (по code) одно предложение, что не так и как правильно; " +
            "recommendations — до 3 советов обучающемуся на следующее занятие. Ответ — только JSON с полями summary, comments, recommendations.",
        },
        { role: "user", content: JSON.stringify(list) },
      ],
      replySchema,
      { temperature: 0.2, maxTokens: 900 },
    );
    return { ...reply, source: "ai", model: aiMode().llm, createdAt: new Date().toISOString() };
  } catch (err) {
    console.error("review draft failed, using rules", err);
    return fallback;
  }
}
