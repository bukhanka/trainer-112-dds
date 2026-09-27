/**
 * System journal: what the system itself did or suffered — server errors and starts, scheduler jobs, backups,
 * the demo reset, integrity checks, services stopped and started. It is a view over the same journal table as
 * the audit (one retention, one CSV export), filtered by event codes.
 */
import type { Prisma } from "@prisma/client";
import { SERVICE_LABELS, type ServiceKey } from "./services";

export const SYSTEM_KINDS = {
  error: { label: "ошибки сервера", prefixes: ["system.error"] },
  start: { label: "запуски сервера", prefixes: ["system.start"] },
  backup: { label: "резервные копии", prefixes: ["backup."] },
  integrity: { label: "контроль целостности", prefixes: ["system.integrity"] },
  service: { label: "службы: пуск и остановка", prefixes: ["service."] },
  cleanup: { label: "очистка по расписанию", prefixes: ["system.cleanup"] },
  demo: { label: "сброс демо-стенда", prefixes: ["demo."] },
} as const;

export type SystemKind = keyof typeof SYSTEM_KINDS;

export function isSystemKind(value: unknown): value is SystemKind {
  return typeof value === "string" && Object.hasOwn(SYSTEM_KINDS, value);
}

/** Journal rows of the system journal, or of one kind of it. */
export function systemWhere(kind?: SystemKind): Prisma.AuditLogWhereInput {
  const prefixes: readonly string[] = kind ? SYSTEM_KINDS[kind].prefixes : Object.values(SYSTEM_KINDS).flatMap((k) => k.prefixes);
  return { OR: prefixes.map((p) => ({ action: { startsWith: p } })) };
}

/** Red in the tables: something went wrong. */
export function isProblem(action: string): boolean {
  return action === "system.error" || action.endsWith(".fail") || action.endsWith(".failed") || action === "service.stop";
}

type Row = { action: string; entity: string | null; entityId: string | null; after: Prisma.JsonValue | null };

const obj = (v: Prisma.JsonValue | null): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const time = (iso: unknown) =>
  typeof iso === "string" ? new Date(iso).toLocaleTimeString("ru-RU", { timeZone: "Europe/Moscow", hour: "2-digit", minute: "2-digit" }) : "";
const serviceName = (key: string | null) => (key && key in SERVICE_LABELS ? SERVICE_LABELS[key as ServiceKey] : (key ?? ""));

/** One line in plain Russian for a system event; unknown events fall back to their data. */
export function systemDetails(row: Row): string {
  const a = obj(row.after);
  switch (row.action) {
    case "system.error":
      return `${row.entityId ?? ""} — ${String(a.message ?? "")}`.trim();
    case "system.start":
      return `процесс ${row.entityId ?? ""}, Node ${String(a.node ?? "")}${a.scheduler ? ", с планировщиком" : ""}${a.demo ? ", демо-стенд" : ""}`;
    case "system.integrity.ok":
      return `пройдены все проверки: ${String(a.checks ?? "")} (${a.trigger === "manual" ? "вручную" : "по расписанию"})`;
    case "system.integrity.fail": {
      const failed = Array.isArray(a.failed) ? a.failed.map(String) : [];
      return `${failed.length} из ${String(a.checks ?? "")}: ${failed.join("; ")}`;
    }
    case "system.cleanup":
      return [
        a.journal ? `записей журнала старше ${String(a.retentionDays)} дн.: ${String(a.journal)}` : "",
        a.backupFiles || a.backupRows ? `копий старше ${String(a.keepDays)} дн.: ${String(a.backupFiles ?? 0)} файлов` : "",
        a.counters ? `счётчиков статистики: ${String(a.counters)}` : "",
        a.sessions ? `истёкших сессий: ${String(a.sessions)}` : "",
        a.practice ? `брошенных тренировок завершено: ${String(a.practice)}` : "",
      ]
        .filter(Boolean)
        .join(", ");
    case "service.stop":
      return `${serviceName(row.entityId)} — остановлено${a.until ? `, включится само в ${time(a.until)}` : ""}`;
    case "service.start":
      return `${serviceName(row.entityId)} — запущено`;
    case "service.auto_start":
      return `${serviceName(row.entityId)} — запущено системой: ${a.reason === "demo-reset" ? "ночной сброс демо-стенда" : "истёк срок остановки на демо-стенде"}`;
    case "demo.defaults": {
      const services = Array.isArray(a.services) ? a.services.map((k) => serviceName(String(k))) : [];
      return [services.length ? `запущены: ${services.join(", ")}` : "", a.policies ? "политики доступа — по умолчанию" : ""].filter(Boolean).join("; ");
    }
    case "demo.reset":
      return `удалено занятий ${String(a.lessons ?? 0)}, сценариев ${String(a.scenarios ?? 0)}, групп ${String(a.groups ?? 0)}, пользователей ${String(a.users ?? 0)}; демо-данные созданы заново`;
    case "backup.manual":
    case "backup.scheduled":
      return "копия базы сделана — список в разделе «Резервные копии»";
    case "demo.reset.failed":
    case "backup.failed":
      return String(a.message ?? "");
    default:
      return row.after ? JSON.stringify(row.after) : row.entity ? `${row.entity} ${row.entityId ?? ""}` : "";
  }
}
