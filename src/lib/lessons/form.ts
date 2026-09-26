/**
 * Lesson form: what the teacher sends when creating or editing a lesson, and how it is checked.
 *
 * Settings are the shared lessonSettingsSchema plus the cabinet-only switch «одна карточка на всех».
 * That switch is materialised into the seats: every place gets the same task list, so the card flow
 * of the workstations needs no special case.
 */
import { z } from "zod";
import { lessonSettingsSchema } from "./settings";

export const teacherSettingsSchema = lessonSettingsSchema.extend({
  sameCard: z.boolean().default(false),
});

export type TeacherSettings = z.infer<typeof teacherSettingsSchema>;

export function parseTeacherSettings(raw: unknown): TeacherSettings {
  const parsed = teacherSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : teacherSettingsSchema.parse({});
}

export const seatInputSchema = z.object({
  studentId: z.string().min(1),
  role: z.enum(["OP112", "DDS"]),
  serviceId: z.number().int().positive().nullable().optional(),
  scenarioIds: z.array(z.string().min(1)).max(50).default([]),
  label: z.string().trim().max(40).optional(),
});

export type SeatInput = z.infer<typeof seatInputSchema>;

export const lessonInputSchema = z.object({
  title: z.string().trim().min(1, "Введите название занятия").max(120, "Название длиннее 120 символов"),
  groupId: z.string().min(1, "Выберите группу"),
  settings: teacherSettingsSchema,
  seats: z.array(seatInputSchema).max(60, "Не больше 60 мест"),
  sharedScenarioIds: z.array(z.string().min(1)).max(50).default([]),
});

export type LessonInput = z.infer<typeof lessonInputSchema>;

export type NormalizedSeat = {
  studentId: string;
  role: "OP112" | "DDS";
  serviceId: number | null;
  scenarioIds: string[];
  label: string;
};

/** Seat defaults and the «одна карточка на всех» mode; also reports duplicates and missing services. */
export function normalizeSeats(input: LessonInput): { seats: NormalizedSeat[]; error?: string } {
  const seen = new Set<string>();
  const seats: NormalizedSeat[] = [];
  for (const [i, s] of input.seats.entries()) {
    if (seen.has(s.studentId)) return { seats: [], error: "Один ученик указан на двух местах" };
    seen.add(s.studentId);
    const scenarioIds = input.settings.sameCard ? input.sharedScenarioIds : s.scenarioIds;
    if (s.role === "DDS" && !s.serviceId) return { seats: [], error: `${s.label || `Место ${i + 1}`}: выберите службу ДДС` };
    seats.push({
      studentId: s.studentId,
      role: s.role,
      serviceId: s.role === "DDS" ? (s.serviceId ?? null) : null,
      scenarioIds: [...new Set(scenarioIds)],
      label: s.label?.trim() || `Место ${i + 1}`,
    });
  }
  return { seats };
}

export function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "Неверные данные";
  return issue.message.startsWith("Invalid") || issue.message.startsWith("Too") ? `Неверное поле: ${issue.path.join(".")}` : issue.message;
}
