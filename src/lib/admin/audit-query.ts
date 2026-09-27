import type { Prisma } from "@prisma/client";
import { isSystemKind, systemWhere, type SystemKind } from "./system-log";

/** scope=system — the system journal (src/lib/admin/system-log.ts), `kind` narrows it. */
export type AuditFilter = { action?: string; actor?: string; from?: string; to?: string; scope?: "system"; kind?: SystemKind };

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
  "group.create": "Создана группа",
  "group.update": "Изменена группа",
  "group.archive": "Группа убрана в архив",
  "group.restore": "Группа возвращена из архива",
  "group.member.add": "Ученик добавлен в группу",
  "group.member.remove": "Ученик убран из группы",
  "setting.update": "Изменена настройка",
  "backup.manual": "Резервная копия вручную",
  "backup.scheduled": "Резервная копия по расписанию",
  "backup.failed": "Ошибка резервного копирования",
  "system.error": "Ошибка сервера",
  "system.start": "Запуск сервера",
  "system.cleanup": "Очистка по расписанию",
  "system.integrity.ok": "Контроль целостности: норма",
  "system.integrity.fail": "Контроль целостности: есть проблемы",
  "service.stop": "Служба остановлена",
  "service.start": "Служба запущена",
  "service.auto_start": "Служба запущена системой",
  "demo.reset": "Ночной сброс демо-стенда",
  "demo.reset.failed": "Ошибка ночного сброса стенда",
  "demo.defaults": "Демо-стенд: службы и политики по умолчанию",
};

export function auditWhere(f: AuditFilter): Prisma.AuditLogWhereInput {
  const at: Prisma.DateTimeFilter = {};
  if (f.from) at.gte = new Date(`${f.from}T00:00:00`);
  if (f.to) at.lte = new Date(`${f.to}T23:59:59`);
  return {
    ...(f.scope === "system" ? systemWhere(f.kind) : {}),
    ...(f.action ? { action: { startsWith: f.action } } : {}),
    ...(f.actor ? { actor: { contains: f.actor, mode: "insensitive" } } : {}),
    ...(f.from || f.to ? { at } : {}),
  };
}

export function readFilter(params: Record<string, string | string[] | undefined>): AuditFilter {
  const one = (k: string) => (typeof params[k] === "string" ? (params[k] as string) : undefined);
  const day = (k: string) => (/^\d{4}-\d{2}-\d{2}$/.test(one(k) ?? "") ? one(k) : undefined);
  const kind = one("kind");
  return {
    action: one("action"),
    actor: one("actor"),
    from: day("from"),
    to: day("to"),
    ...(one("scope") === "system" ? { scope: "system" as const, ...(isSystemKind(kind) ? { kind } : {}) } : {}),
  };
}
