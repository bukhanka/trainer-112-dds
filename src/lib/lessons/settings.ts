import { z } from "zod";

/** Lesson settings (Lesson.settings). Defaults follow the dispatcher memo and the customer's Q&A. */
export const lessonSettingsSchema = z.object({
  categories: z.array(z.string()).default([]), // incident groups to draw scenarios from; empty = all approved
  // округ / район: places without tasks draw only scenarios of this location; null = any (src/lib/scenarios/location.ts)
  location: z
    .object({ okrug: z.string().trim().min(1).max(20), district: z.string().trim().min(1).max(80).nullable().default(null) })
    .nullable()
    .default(null),
  cardSource: z.enum(["generated", "students", "mixed"]).default("generated"),
  tempoSec: z.number().int().min(10).max(1800).default(90), // a new card for each ДДС place every N seconds
  maxQueue: z.number().int().min(1).max(10).default(3), // cards waiting at one place at most
  ackSec: z.number().int().min(5).max(600).default(30), // ДДС: open the card, from «Добавлена» (customer's answer of 27.09)
  workSec: z.number().int().min(30).max(3600).default(180), // ДДС: the first record — status and text — from «Добавлена»
  typingSec: z.number().int().min(20).max(600).default(65), // 112 card typing timer turns red
  // Pass criteria (ТЗ п.99, src/lib/scoring/pass.ts): «зачтено» — score at least passScore and no more failed critical checks than maxCritical.
  passScore: z.number().int().min(0).max(100).default(70),
  maxCritical: z.number().int().min(0).max(10).default(0),
  // Phrase the final comment of a ДДС place must contain, one template per line (src/lib/scoring/template.ts); empty — no such check.
  commentTemplate: z.string().max(400).default(""),
  hints: z.boolean().default(false), // «режим чайника»: tips on fields and next steps
  brigadeReports: z.boolean().default(true), // brigade leaders call the ДДС with progress
  practice: z.boolean().default(false), // a student's own lesson started from the workstation («Тренировка без занятия»)
  adaptive: z.boolean().default(true), // a place without assigned tasks gets tasks near the student's level (src/lib/adaptive)
});

export type LessonSettings = z.infer<typeof lessonSettingsSchema>;

/**
 * Whether a place without tasks gets them by the student's level: not when the teacher switched it off,
 * and not in «одна карточка на всех» (Lesson.settings.sameCard of the teacher's form) — there every
 * place must see the same cards even when no task is marked.
 */
export function adaptiveChoice(raw: unknown): boolean {
  const s = raw && typeof raw === "object" ? (raw as { adaptive?: unknown; sameCard?: unknown }) : {};
  return s.adaptive !== false && s.sameCard !== true;
}

export function parseLessonSettings(raw: unknown): LessonSettings {
  return lessonSettingsSchema.parse(raw ?? {});
}
