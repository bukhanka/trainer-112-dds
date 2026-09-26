import { AUDIT_LABELS, auditWhere, readFilter } from "@/lib/admin/audit-query";
import { apiUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

const MAX_ROWS = 50_000;

const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

export async function GET(request: Request) {
  const user = await apiUser(["ADMIN"]);
  if (user instanceof Response) return user;

  const params = Object.fromEntries(new URL(request.url).searchParams);
  const rows = await db.auditLog.findMany({ where: auditWhere(readFilter(params)), orderBy: { at: "desc" }, take: MAX_ROWS });
  const lines = [
    ["Когда", "Кто", "Событие", "Код события", "Объект", "Было", "Стало", "IP"].map(cell).join(";"),
    ...rows.map((r) =>
      [
        formatDateTime(r.at, true),
        r.actor,
        AUDIT_LABELS[r.action] ?? r.action,
        r.action,
        r.entity ? `${r.entity} ${r.entityId ?? ""}` : "",
        r.before ? JSON.stringify(r.before) : "",
        r.after ? JSON.stringify(r.after) : "",
        r.ip,
      ]
        .map(cell)
        .join(";"),
    ),
  ];
  // BOM so that Excel opens UTF-8 Cyrillic correctly.
  return new Response(`﻿${lines.join("\r\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="audit-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
