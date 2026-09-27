import { AUDIT_LABELS, auditWhere, readFilter } from "@/lib/admin/audit-query";
import { systemDetails } from "@/lib/admin/system-log";
import { apiUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { attachment, toCsv } from "@/lib/reports/csv";

const MAX_ROWS = 50_000;

/** CSV of the audit journal, or of the system journal with scope=system; the same filters as on the pages. */
export async function GET(request: Request) {
  const user = await apiUser(["ADMIN"]);
  if (user instanceof Response) return user;

  const filter = readFilter(Object.fromEntries(new URL(request.url).searchParams));
  const rows = await db.auditLog.findMany({ where: auditWhere(filter), orderBy: { at: "desc" }, take: MAX_ROWS });
  const system = filter.scope === "system";
  const json = (v: unknown) => (v == null ? "" : JSON.stringify(v));
  // toCsv keeps text that starts like a formula as text: a login typed at the login screen can be anything.
  const csv = system
    ? toCsv([
        ["Когда", "Событие", "Код события", "Подробности", "Кто", "Данные"],
        ...rows.map((r) => [formatDateTime(r.at, true), AUDIT_LABELS[r.action] ?? r.action, r.action, systemDetails(r), r.actor, json(r.after)]),
      ])
    : toCsv([
        ["Когда", "Кто", "Событие", "Код события", "Объект", "Было", "Стало", "IP"],
        ...rows.map((r) => [
          formatDateTime(r.at, true),
          r.actor,
          AUDIT_LABELS[r.action] ?? r.action,
          r.action,
          r.entity ? `${r.entity} ${r.entityId ?? ""}` : "",
          json(r.before),
          json(r.after),
          r.ip,
        ]),
      ]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachment(`${system ? "system-log" : "audit"}-${new Date().toISOString().slice(0, 10)}.csv`),
    },
  });
}
