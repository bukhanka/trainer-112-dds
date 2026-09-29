import type { Prisma } from "@prisma/client";
import { isSystemKind, systemWhere, type SystemKind } from "./system-log";

/** scope=system — the system journal (src/lib/admin/system-log.ts), `kind` narrows it. */
export type AuditFilter = { action?: string; actor?: string; from?: string; to?: string; scope?: "system"; kind?: SystemKind };

/**
 * Every event the code writes to the journal, in plain Russian. tests/audit-labels.test.ts reads the code and
 * fails when an event has no name here.
 */
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
  "lesson.create": "Создано занятие",
  "lesson.update": "Изменено занятие",
  "lesson.delete": "Удалено занятие",
  "lesson.copy": "Занятие повторено («Провести ещё раз»)",
  "lesson.start": "Занятие начато",
  "lesson.stop": "Занятие завершено",
  "followup.create": "Назначена отработка ошибки",
  "followup.cancel": "Отработка отменена преподавателем",
  "followup.observe": "Преподаватель отметил наблюдение по этапу отработки",
  "followup.repeat": "Этап отработки назначен повторно (новое занятие)",
  "followup.replace_control": "Контрольная ситуация заменена",
  "report.export": "Отчёт занятия выгружен в CSV",
  "op112.training.start": "Место 112: самостоятельная тренировка начата",
  "op112.training.finish": "Место 112: самостоятельная тренировка завершена",
  "op112.card.save": "Место 112: карточка сохранена",
  "op112.card.link": "Место 112: карточка связана как совпадение",
  "op112.card.unlink": "Место 112: связь совпадения снята",
  "op112.card.supplement": "Место 112: дополнение к карточке",
  "dds.practice.start": "Место ДДС: самостоятельная тренировка начата",
  "dds.practice.finish": "Место ДДС: самостоятельная тренировка завершена",
  "dds.status": "Место ДДС: статус службы",
  "attempt.draft": "Черновик разбора собран заново",
  "attempt.confirm": "Оценка подтверждена преподавателем",
  "attempt.override": "Оценка исправлена преподавателем",
  "attempt.reopen": "Оценка возвращена на проверку",
  "attempt.bulk_confirm": "Оценки подтверждены списком",
  "correction.add": "Правка ИИ-проверки добавлена",
  "correction.revise": "Правка ИИ-проверки заменена",
  "correction.on": "Правка ИИ-проверки включена",
  "correction.off": "Правка ИИ-проверки выключена",
  "weights.update": "Изменены веса оценки",
  "scenario.generate": "Сценарий создан генератором",
  "scenario.update": "Сценарий изменён",
  "scenario.regenerate": "Раздел сценария переписан по замечанию",
  "scenario.fix.requested": "Замечание к сценарию сохранено",
  "scenario.approve": "Сценарий утверждён",
  "scenario.unapprove": "Утверждение сценария снято",
  "scenario.archive": "Сценарий убран в архив",
  "scenario.restore": "Сценарий возвращён из архива",
  "material.upload": "Загружен материал",
  "material.delete": "Удалён материал",
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

/** Kinds of events for the journal filter: the code prefix and its name. */
export const AUDIT_KINDS: { value: string; label: string }[] = [
  { value: "auth", label: "вход и выход" },
  { value: "user", label: "пользователи" },
  { value: "group", label: "группы" },
  { value: "lesson", label: "занятия" },
  { value: "followup", label: "отработка навыков" },
  { value: "op112", label: "работа на местах 112" },
  { value: "dds", label: "работа на местах ДДС" },
  { value: "attempt", label: "оценки" },
  { value: "correction", label: "правки ИИ-проверок" },
  { value: "weights", label: "веса оценки" },
  { value: "scenario", label: "сценарии" },
  { value: "material", label: "материалы" },
  { value: "report", label: "отчёты" },
  { value: "setting", label: "настройки" },
  { value: "service", label: "службы" },
  { value: "backup", label: "резервные копии" },
  { value: "system", label: "система" },
  { value: "demo", label: "демо-стенд" },
];

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
