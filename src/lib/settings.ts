import { db } from "./db";

/** System setting from the database with a fallback; admins edit them in /admin/settings. */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.systemSetting.findUnique({ where: { key } });
  return row ? (row.value as T) : fallback;
}
