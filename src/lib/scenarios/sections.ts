import { learningMetaSchema } from "@/lib/followup/metadata";
/**
 * A scenario is approved section by section: the teacher may accept the caller persona and keep the
 * reference answers in draft. The scenario is ready for lessons only when every present section is
 * approved; anything generated stays a draft until then.
 */
import { z } from "zod";

export const SECTIONS = [
  { key: "caller", title: "Заявитель", hint: "Кто звонит, что говорит сразу и что — только на уточняющий вопрос" },
  { key: "truth", title: "Эталон карточки 112", hint: "Тип происшествия, признаки, адрес, службы, обязательные вопросы" },
  { key: "ddsCard", title: "Карточка на месте ДДС", hint: "Что видит диспетчер ДДС в ленте и в карточке" },
  { key: "ddsReference", title: "Эталон действий ДДС", hint: "Решение по каждой службе, цепочка статусов, что должно быть в комментарии, ловушки" },
] as const;

export type SectionKey = (typeof SECTIONS)[number]["key"];

export const SECTION_KEYS = SECTIONS.map((s) => s.key) as SectionKey[];

export const sectionKeySchema = z.enum(SECTION_KEYS as [SectionKey, ...SectionKey[]]);

type WithSections = { caller: unknown; truth: unknown; ddsCard: unknown; ddsReference: unknown };

export function presentSections(s: WithSections): SectionKey[] {
  return SECTION_KEYS.filter((k) => s[k] != null && !(typeof s[k] === "object" && !Array.isArray(s[k]) && Object.keys(s[k] as object).length === 0));
}

/** Status after a change of approvals: approved when every present section is approved. */
export function statusFor(approved: string[], present: SectionKey[], current: "DRAFT" | "APPROVED" | "ARCHIVED"): "DRAFT" | "APPROVED" | "ARCHIVED" {
  if (current === "ARCHIVED") return "ARCHIVED";
  return present.length > 0 && present.every((k) => approved.includes(k)) ? "APPROVED" : "DRAFT";
}

export function nextApprovals(current: string[], sections: SectionKey[], approve: boolean): string[] {
  const set = new Set(current.filter((k) => (SECTION_KEYS as string[]).includes(k)));
  for (const k of sections) {
    if (approve) set.add(k);
    else set.delete(k);
  }
  return SECTION_KEYS.filter((k) => set.has(k));
}

const text = z.string().trim().max(2000);

/** Caller persona: known fields are checked, unknown ones written by the generator are kept. */
export const callerSchema = z
  .object({
    fullName: text.min(1, "Укажите ФИО заявителя"),
    role: text.default(""),
    phone: text.optional(),
    visibleAddress: text.min(1, "Укажите адрес, который заявитель называет сразу"),
    hiddenAddress: text.optional(),
    situation: text.min(1, "Опишите, что случилось, словами заявителя"),
    facts: z.array(text).max(30).default([]),
    temper: z.enum(["calm", "panic", "elderly", "child", "drunk", "angry"]).optional(),
    voice: z.enum(["male", "female"]).optional(),
  })
  .passthrough();

export const jsonSectionSchema = z.record(z.string(), z.unknown());

export const scenarioPatchSchema = z.object({
  title: text.min(1).max(200).optional(),
  category: text.min(1).max(80).optional(),
  difficulty: z.number().int().min(1).max(10).optional(),
  teacherNote: z.string().trim().max(4000).nullable().optional(),
  learningMeta: learningMetaSchema.nullable().optional(),
  caller: callerSchema.optional(),
  truth: jsonSectionSchema.optional(),
  ddsCard: jsonSectionSchema.nullable().optional(),
  ddsReference: jsonSectionSchema.nullable().optional(),
});

export const TEMPERS: Record<string, string> = {
  calm: "спокойный",
  panic: "в панике",
  elderly: "пожилой",
  child: "ребёнок",
  drunk: "нетрезвый",
  angry: "раздражённый",
};
