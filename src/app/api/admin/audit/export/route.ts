import { AUDIT_LABELS, auditWhere, readFilter } from "@/lib/admin/audit-query";
import { loadAuditNames } from "@/lib/admin/audit-names";
import { auditActor, auditChanges, auditObject, changesText } from "@/lib/admin/audit-view";
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
  const names = await loadAuditNames(rows);
  const json = (v: unknown) => (v == null ? "" : JSON.stringify(v));
  // One column with the event in words; its code goes last, for filters and pivot tables in Excel.
  // toCsv keeps text that starts like a formula as text: a login typed at the login screen can be anything.
  const csv = system
    ? toCsv([
        ["Когда", "Событие", "Подробности", "Кто", "Код события", "Данные"],
        ...rows.map((r) => [formatDateTime(r.at, true), AUDIT_LABELS[r.action] ?? r.action, systemDetails(r), auditActor(r, names), r.action, json(r.after)]),
      ])
    : toCsv([
        ["Когда", "Кто", "Событие", "Объект", "Что изменилось", "IP", "Код события"],
        ...rows.map((r) => [
          formatDateTime(r.at, true),
          auditActor(r, names),
          AUDIT_LABELS[r.action] ?? r.action,
          auditObject(r, names),
          changesText(auditChanges(r, names)),
          r.ip,
          r.action,
        ]),
      ]);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachment(`${system ? "system-log" : "audit"}-${new Date().toISOString().slice(0, 10)}.csv`),
    },
  });
}
