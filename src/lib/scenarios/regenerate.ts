import type { z } from "zod";
import { aiMode, chatJson } from "@/lib/ai/provider";
import { callerSchema, jsonSectionSchema, SECTIONS, type SectionKey } from "./sections";

export type RegenerateResult = { ok: true; value: Record<string, unknown>; model: string } | { ok: false; mock: boolean; error: string };

/**
 * «Исправь»: the model rewrites one section following the teacher's comment and keeps its structure.
 * The result is a draft again — the teacher approves it like any generated text.
 */
export async function regenerateSection(
  scenario: { title: string; category: string; caller: unknown },
  section: SectionKey,
  current: unknown,
  comment: string,
): Promise<RegenerateResult> {
  if (aiMode().llm === "mock") {
    return {
      ok: false,
      mock: true,
      error: "Модель ИИ не подключена (режим заглушки), поэтому перегенерировать раздел нельзя. Замечание сохранено в заметке преподавателя — исправьте раздел вручную или подключите модель в .env (LLM_BASE_URL).",
    };
  }
  const meta = SECTIONS.find((s) => s.key === section)!;
  const schema = (section === "caller" ? callerSchema : jsonSectionSchema) as z.ZodType<Record<string, unknown>>;
  try {
    const value = await chatJson(
      [
        {
          role: "system",
          content:
            "Ты методист учебного центра, который готовит тренировочные вызовы для операторов Системы 112 и диспетчеров ДДС Москвы. " +
            `Перепиши раздел «${meta.title}» (${meta.hint}) учебного сценария с учётом замечания преподавателя. ` +
            "Замечание преподавателя главнее исходного текста, не спорь с ним. Сохрани структуру: те же поля и типы значений, пиши по-русски. " +
            "Верни только JSON раздела, без пояснений.",
        },
        { role: "user", content: JSON.stringify({ scenario: { title: scenario.title, category: scenario.category, caller: scenario.caller }, section: current, comment }) },
      ],
      schema,
      { temperature: 0.3, maxTokens: 1800 },
    );
    return { ok: true, value, model: aiMode().llm };
  } catch (err) {
    console.error("scenario regenerate failed", err);
    return { ok: false, mock: false, error: "Модель не ответила или вернула неверный формат. Попробуйте ещё раз или исправьте раздел вручную." };
  }
}
