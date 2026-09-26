import type { Prisma } from "@prisma/client";

export type AuditFilter = { action?: string; actor?: string; from?: string; to?: string };

export const AUDIT_LABELS: Record<string, string> = {
  "auth.login.ok": "Вход",
  "auth.login.fail": "Неудачный вход",
  "auth.login.blocked": "Вход заблокированного",
  "auth.login.locked": "Вход во время блокировки",
  "auth.lockout": "Блокировка после перебора пароля",
  "auth.logout": "Выход",
  "user.create": "Создан пользователь",
  "user.block": "Пользователь заблокирован",
  "user.unblock": "Пользователь разблокирован",
  "user.password_reset": "Сменён пароль",
  "setting.update": "Изменена настройка",
  "backup.manual": "Резервная копия вручную",
  "backup.scheduled": "Резервная копия по расписанию",
  "backup.failed": "Ошибка резервного копирования",
  "system.error": "Ошибка сервера",
};

export function auditWhere(f: AuditFilter): Prisma.AuditLogWhereInput {
  const at: Prisma.DateTimeFilter = {};
  if (f.from) at.gte = new Date(`${f.from}T00:00:00`);
  if (f.to) at.lte = new Date(`${f.to}T23:59:59`);
  return {
    ...(f.action ? { action: { startsWith: f.action } } : {}),
    ...(f.actor ? { actor: { contains: f.actor, mode: "insensitive" } } : {}),
    ...(f.from || f.to ? { at } : {}),
  };
}

export function readFilter(params: Record<string, string | string[] | undefined>): AuditFilter {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  return { action: one("action"), actor: one("actor"), from: one("from"), to: one("to") };
}
