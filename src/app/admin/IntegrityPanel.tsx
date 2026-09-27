"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { IntegrityReport } from "@/lib/admin/integrity";
import { formatDateTime } from "@/lib/format";

/** The latest integrity check with every item and a button to run it now. */
export function IntegrityPanel({ initial, dailyAt }: { initial: IntegrityReport | null; dailyAt: string }) {
  const router = useRouter();
  const [report, setReport] = useState(initial);
  const [running, setRunning] = useState(false);
  const [failure, setFailure] = useState("");

  async function runNow() {
    setRunning(true);
    setFailure("");
    try {
      const res = await fetch("/api/admin/integrity", { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      setReport(((await res.json()) as { report: IntegrityReport }).report);
      router.refresh(); // the red banner at the top follows the new result
    } catch {
      setFailure("Проверка не выполнилась — нет связи с сервером. Попробуйте ещё раз.");
    } finally {
      setRunning(false);
    }
  }

  const failed = report?.checks.filter((c) => !c.ok).length ?? 0;
  return (
    <section id="integrity" className="flex scroll-mt-4 flex-col gap-3" aria-labelledby="integrity-title">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id="integrity-title" className="text-lg font-semibold">
          Контроль целостности
        </h2>
        <span className="text-xs text-arm-desc">
          каждый день в {dailyAt} по расписанию и по кнопке · результат пишется в системный журнал
        </span>
        <button onClick={runNow} disabled={running} className="h-8 bg-arm-blue px-3 text-sm text-white disabled:opacity-60 sm:ml-auto">
          {running ? "Проверяем…" : "Проверить сейчас"}
        </button>
      </div>
      {failure && <p className="text-sm text-arm-late">{failure}</p>}
      {!report ? (
        <p className="rounded border bg-white p-3 text-sm text-arm-desc">Проверка ещё не выполнялась.</p>
      ) : (
        <div className={`rounded border bg-white text-sm ${report.ok ? "" : "border-arm-late"}`}>
          <p className={`border-b px-3 py-2 font-medium ${report.ok ? "text-emerald-700" : "text-arm-late"}`} role="status">
            {report.ok ? "Всё в порядке" : `Найдено проблем: ${failed} из ${report.checks.length}`}
            <span className="font-normal text-arm-desc">
              {" "}
              · {formatDateTime(report.at, true)} · {report.trigger === "manual" ? `вручную, ${report.by}` : "по расписанию"} · {report.ms} мс
            </span>
          </p>
          <ul className="divide-y">
            {report.checks.map((c) => (
              <li key={c.code} className="grid gap-x-3 px-3 py-2 sm:grid-cols-[14rem_minmax(0,1fr)]">
                <span className={`flex items-center gap-2 font-medium ${c.ok ? "" : "text-arm-late"}`}>
                  <span aria-hidden className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] text-white ${c.ok ? "bg-emerald-600" : "bg-arm-late"}`}>
                    {c.ok ? "✓" : "!"}
                  </span>
                  {c.title}
                  <span className="sr-only">{c.ok ? " — в порядке" : " — проблема"}</span>
                </span>
                <span className={`break-words ${c.ok ? "text-arm-desc" : ""}`}>{c.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
