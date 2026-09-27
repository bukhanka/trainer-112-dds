import Link from "next/link";
import { AUDIT_LABELS, auditWhere, readFilter } from "@/lib/admin/audit-query";
import { isProblem, SYSTEM_KINDS, systemDetails } from "@/lib/admin/system-log";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

const PAGE_SIZE = 50;

function errorsLastDay() {
  return db.auditLog.count({ where: { action: "system.error", at: { gte: new Date(Date.now() - 86_400_000) } } });
}

export default async function SystemLogPage({ searchParams }: PageProps<"/admin/system-log">) {
  await requireUser(["ADMIN"]);
  const params = await searchParams;
  const filter = { ...readFilter({ ...params, scope: "system" }), action: undefined, actor: undefined };
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const where = auditWhere(filter);
  const [rows, total, errorsDay] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { at: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.auditLog.count({ where }),
    errorsLastDay(),
  ]);
  const query = new URLSearchParams(Object.entries({ scope: "system", kind: filter.kind, from: filter.from, to: filter.to }).filter(([, v]) => v) as [string, string][]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-xl font-semibold">Системный журнал</h1>
        <span className="text-xs text-arm-desc">
          что делала и что пережила сама система — отдельно от действий пользователей (они в «Журнале аудита») · ошибок сервера за сутки: {errorsDay}
        </span>
      </div>
      <form className="flex flex-wrap items-end gap-2 rounded border bg-white p-3 text-sm">
        <label className="flex flex-col text-xs text-arm-desc">
          Событие
          <select name="kind" defaultValue={filter.kind ?? ""} className="h-9 border px-2">
            <option value="">все системные</option>
            {Object.entries(SYSTEM_KINDS).map(([value, k]) => (
              <option key={value} value={value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-arm-desc">
          С
          <input type="date" name="from" defaultValue={filter.from} className="h-9 border px-2" />
        </label>
        <label className="flex flex-col text-xs text-arm-desc">
          По
          <input type="date" name="to" defaultValue={filter.to} className="h-9 border px-2" />
        </label>
        <button className="h-9 bg-arm-blue px-4 text-white">Показать</button>
        <a href={`/api/admin/audit/export?${query}`} className="h-9 border px-3 leading-9">
          Выгрузить CSV
        </a>
        <span className="ml-auto text-xs text-arm-desc">записей: {total}</span>
      </form>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-arm-panel text-left text-xs text-arm-desc">
            <tr>
              <th className="p-2">Когда</th>
              <th className="p-2">Событие</th>
              <th className="p-2">Подробности</th>
              <th className="p-2">Кто</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t align-top">
                <td className="whitespace-nowrap p-2 text-xs">{formatDateTime(r.at, true)}</td>
                <td className={`p-2 ${isProblem(r.action) ? "text-arm-late" : ""}`}>{AUDIT_LABELS[r.action] ?? r.action}</td>
                <td className="max-w-xl p-2 text-xs break-words">{systemDetails(r)}</td>
                <td className="p-2 text-xs">{r.actor ?? "—"}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={4} className="p-4 text-center text-arm-desc">
                  Событий нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <nav className="flex gap-2 text-sm">
        {page > 1 && <Link href={`?${query}&page=${page - 1}`}>← раньше</Link>}
        <span className="text-arm-desc">
          страница {page} из {pages}
        </span>
        {page < pages && <Link href={`?${query}&page=${page + 1}`}>дальше →</Link>}
      </nav>
    </div>
  );
}
