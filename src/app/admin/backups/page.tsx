import { revalidatePath } from "next/cache";
import { runBackup } from "@/lib/admin/backup";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { getSetting } from "@/lib/settings";

async function backupNow() {
  "use server";
  const admin = await requireUser(["ADMIN"]);
  await runBackup("manual", admin);
  revalidatePath("/admin/backups");
}

export default async function BackupsPage() {
  const [rows, dailyAt, keepDays] = await Promise.all([
    db.backup.findMany({ orderBy: { createdAt: "desc" }, take: 60 }),
    getSetting("backup.dailyAt", "03:00"),
    getSetting("backup.keepDays", 14),
  ]);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Резервные копии</h1>
      <div className="flex flex-wrap items-center gap-4 rounded border bg-white p-3 text-sm">
        <span>
          Автоматически каждый день в <b>{dailyAt}</b>, храним <b>{keepDays}</b> дн. (меняется в настройках)
        </span>
        <form action={backupNow} className="ml-auto">
          <button className="h-9 bg-arm-blue px-4 text-white">Сделать копию сейчас</button>
        </form>
      </div>
      <p className="text-xs text-arm-desc">
        Восстановление — из консоли сервера командой <code>scripts/restore.sh &lt;файл&gt;</code>: кнопки в интерфейсе нет
        намеренно, чтобы случайный клик не стёр идущее занятие. Подробно — docs/admin.md.
      </p>
      <div className="overflow-x-auto rounded border bg-white">
        <table className="w-full min-w-[600px] text-sm">
          <thead className="bg-arm-panel text-left text-xs text-arm-desc">
            <tr>
              <th className="p-2">Когда</th>
              <th className="p-2">Как</th>
              <th className="p-2">Файл</th>
              <th className="p-2">Размер</th>
              <th className="p-2">Итог</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id} className="border-t">
                <td className="p-2 text-xs">{formatDateTime(b.createdAt, true)}</td>
                <td className="p-2">{b.kind === "manual" ? "вручную" : "по расписанию"}</td>
                <td className="p-2 font-mono text-xs">{b.fileName}</td>
                <td className="p-2">{b.sizeBytes ? `${(Number(b.sizeBytes) / 1e6).toFixed(1)} МБ` : "—"}</td>
                <td className={`p-2 ${b.status === "failed" ? "text-arm-late" : ""}`}>
                  {b.status === "ok" ? "успешно" : b.status === "running" ? "идёт" : `ошибка: ${b.error ?? ""}`}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={5} className="p-4 text-center text-arm-desc">
                  Копий ещё нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
