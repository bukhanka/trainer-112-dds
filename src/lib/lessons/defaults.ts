import { getSetting } from "@/lib/settings";
import { teacherSettingsSchema, type TeacherSettings } from "./form";

/** Form defaults: schema defaults with the norms the administrator set for the whole centre. */
export async function defaultTeacherSettings(): Promise<TeacherSettings> {
  const base = teacherSettingsSchema.parse({});
  const [ackSec, workSec, typingSec] = await Promise.all([
    getSetting("norm.ackSec", base.ackSec),
    getSetting("norm.workSec", base.workSec),
    getSetting("norm.typingSec", base.typingSec),
  ]);
  const parsed = teacherSettingsSchema.safeParse({ ...base, ackSec, workSec, typingSec });
  return parsed.success ? parsed.data : base;
}
