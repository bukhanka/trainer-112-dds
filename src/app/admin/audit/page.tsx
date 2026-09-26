import Link from "next/link";
import { AUDIT_LABELS, auditWhere, readFilter } from "@/lib/admin/audit-query";
import { db } from "@/lib/db";

const PAGE_SIZE = 50;

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  const params = await searchParams;
  const filter = readFilter(params);
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const where = auditWhere(filter);
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { at: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.auditLog.count({ where }),
  ]);
  const query = new URLSearchParams(Object.entries(filter).filter(([, v]) => v) as [string, string][]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Журнал аудита</h1>
      <form className="flex flex-wrap items-end gap-2 rounded border bg-white p-3 text-sm">
        <label className="flex flex-col text-xs text-arm-desc">
          Событие
          <select name="action" defaultValue={filter.action ?? ""} className="h-9 border px-2">
            <option value="">все</option>
            <option value="auth">вход и выход</option>
            <option value="user">пользователи</option>
            <option value="attempt">оценки</option>
            <option value="lesson">занятия</option>
            <option value="scenario">сценарии</option>
            <option value="setting">настройки</option>
            <option value="backup">резервные копии</option>
            <option value="system.error">ошибки сервера</option>
          </select>
        </label>
        <label className="flex flex-col text-xs text-arm-desc">
          Кто
          <input name="actor" defaultValue={filter.actor} className="h-9 border px-2" />
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
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-arm-panel text-left text-xs text-arm-desc">
            <tr>
              <th className="p-2">Когда</th>
              <th className="p-2">Кто</th>
              <th className="p-2">Событие</th>
              <th className="p-2">Объект</th>
              <th className="p-2">Было → стало</th>
              <th className="p-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t align-top">
                <td className="whitespace-nowrap p-2 text-xs">{r.at.toLocaleString("ru-RU")}</td>
                <td className="p-2">{r.actor ?? "—"}</td>
                <td className={`p-2 ${r.action === "system.error" || r.action.includes("fail") ? "text-arm-late" : ""}`}>
                  {AUDIT_LABELS[r.action] ?? r.action}
                </td>
                <td className="p-2 text-xs">{r.entity ? `${r.entity} ${r.entityId ?? ""}` : "—"}</td>
                <td className="max-w-md p-2 font-mono text-xs break-words">
                  {r.before ? JSON.stringify(r.before) : ""}
                  {r.before && r.after ? " → " : ""}
                  {r.after ? JSON.stringify(r.after) : ""}
                </td>
                <td className="p-2 text-xs">{r.ip ?? ""}</td>
              </tr>
            ))}
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
