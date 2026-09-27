import Link from "next/link";
import { AUDIT_KINDS, AUDIT_LABELS, auditWhere, readFilter } from "@/lib/admin/audit-query";
import { loadAuditNames } from "@/lib/admin/audit-names";
import { auditActor, auditChanges, auditObject, type AuditChange } from "@/lib/admin/audit-view";
import { isProblem } from "@/lib/admin/system-log";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";

const PAGE_SIZE = 50;
/** Changes shown at once; the rest open on a click. */
const SHOWN = 3;
const LONG = 140;

export default async function AuditPage({ searchParams }: PageProps<"/admin/audit">) {
  await requireUser(["ADMIN"]);
  const params = await searchParams;
  const filter = readFilter(params);
  const page = Math.max(1, Number(params.page ?? 1) || 1);
  const where = auditWhere(filter);
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { at: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.auditLog.count({ where }),
  ]);
  const names = await loadAuditNames(rows);
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
            {AUDIT_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs text-arm-desc">
          Кто (логин)
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
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-arm-panel text-left text-xs text-arm-desc">
            <tr>
              <th className="p-2">Когда</th>
              <th className="p-2">Кто</th>
              <th className="p-2">Событие</th>
              <th className="p-2">Объект</th>
              <th className="p-2">Что изменилось</th>
              <th className="p-2">IP</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t align-top">
                <td className="whitespace-nowrap p-2 text-xs">{formatDateTime(r.at, true)}</td>
                <td className="p-2 text-xs break-words">{auditActor(r, names)}</td>
                <td className={`p-2 ${isProblem(r.action) || r.action.includes("fail") || r.action === "auth.lockout" ? "text-arm-late" : ""}`}>
                  {AUDIT_LABELS[r.action] ?? r.action}
                </td>
                <td className="p-2 text-xs break-words">{auditObject(r, names)}</td>
                <td className="max-w-md p-2 text-xs">
                  <Changes list={auditChanges(r, names)} />
                </td>
                <td className="p-2 text-xs">{r.ip ?? ""}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="p-4 text-center text-arm-desc">
                  Записей нет
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

/** «поле: было → стало», the first few at once and the rest on a click; a long value opens in full. */
function Changes({ list }: { list: AuditChange[] }) {
  if (!list.length) return <span className="text-arm-desc">—</span>;
  const lines = list.map((c, i) => (
    <li key={i} className="break-words">
      <span className="text-arm-desc">{c.field}:</span>{" "}
      {c.before !== undefined && c.after !== undefined ? (
        <>
          <Value text={c.before} /> → <Value text={c.after} />
        </>
      ) : (
        <Value text={c.after ?? c.before ?? ""} />
      )}
    </li>
  ));
  return (
    <ul className="flex flex-col gap-0.5">
      {lines.slice(0, SHOWN)}
      {lines.length > SHOWN && (
        <li>
          <details>
            <summary className="cursor-pointer text-arm-blue">ещё {lines.length - SHOWN}</summary>
            <ul className="mt-0.5 flex flex-col gap-0.5">{lines.slice(SHOWN)}</ul>
          </details>
        </li>
      )}
    </ul>
  );
}

function Value({ text }: { text: string }) {
  if (text.length <= LONG) return <span>{text}</span>;
  return (
    <details className="inline">
      <summary className="inline cursor-pointer">
        {text.slice(0, LONG)}… <span className="text-arm-blue">полностью</span>
      </summary>
      <span className="mt-0.5 block whitespace-pre-wrap rounded bg-arm-panel p-1">{text}</span>
    </details>
  );
}
