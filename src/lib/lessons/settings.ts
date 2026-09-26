import { z } from "zod";

/** Lesson settings (Lesson.settings). Defaults follow the dispatcher memo and the customer's Q&A. */
export const lessonSettingsSchema = z.object({
  categories: z.array(z.string()).default([]), // incident groups to draw scenarios from; empty = all approved
  cardSource: z.enum(["generated", "students", "mixed"]).default("generated"),
  tempoSec: z.number().int().min(10).max(1800).default(90), // a new card for each ДДС place every N seconds
  maxQueue: z.number().int().min(1).max(10).default(3), // cards waiting at one place at most
  ackSec: z.number().int().min(5).max(600).default(30), // «Принята / Не принята» after «Добавлена»
  workSec: z.number().int().min(30).max(3600).default(180), // processing a card
  typingSec: z.number().int().min(20).max(600).default(65), // 112 card typing timer turns red
  hints: z.boolean().default(false), // «режим чайника»: tips on fields and next steps
  brigadeReports: z.boolean().default(true), // brigade leaders call the ДДС with progress
});

export type LessonSettings = z.infer<typeof lessonSettingsSchema>;

export function parseLessonSettings(raw: unknown): LessonSettings {
  return lessonSettingsSchema.parse(raw ?? {});
}
