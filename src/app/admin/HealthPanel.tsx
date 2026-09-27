"use client";

import useSWR from "swr";
import type { Health } from "@/lib/admin/health";
import { formatDateTime, formatTime } from "@/lib/format";

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));

export function HealthPanel({ initial }: { initial: Health }) {
  const { data = initial, error } = useSWR<Health>("/api/admin/health", fetcher, { refreshInterval: 5000, fallbackData: initial });
  const loadPct = Math.round((data.load[0] / data.cpus) * 100);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold">Состояние системы</h1>
        <span className="text-xs text-arm-desc">
          обновлено {formatTime(data.at, true)}
          {error ? " · нет связи с сервером" : " · раз в 5 с"}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label="База данных" value={data.db.ok ? `работает · ${data.db.ms} мс` : "недоступна"} bad={!data.db.ok} />
        <Tile label="Нагрузка CPU (1 мин)" value={`${loadPct} % · ${data.cpus} ядер`} bad={loadPct > 90} />
        <Tile label="Память" value={`${data.memory.usedMb} из ${data.memory.totalMb} МБ · приложение ${data.memory.processMb} МБ`} />
        <Tile label="Диск" value={data.disk ? `свободно ${data.disk.freeGb} из ${data.disk.totalGb} ГБ` : "—"} bad={!!data.disk && data.disk.freeGb < 2} />
        <Tile label="Активных сессий" value={String(data.activeSessions)} />
        <Tile label="Идёт занятий" value={String(data.runningLessons)} />
        <Tile label="Ошибок сервера за час" value={String(data.errorsLastHour)} bad={data.errorsLastHour > 0} />
        <Tile
          label="Последняя резервная копия"
          value={data.lastBackup ? `${formatDateTime(data.lastBackup.at)} · ${data.lastBackup.status === "ok" ? "успешно" : data.lastBackup.status}` : "ещё не было"}
          bad={data.lastBackup?.status === "failed"}
        />
      </div>
    </div>
  );
}

function Tile({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className={`rounded border bg-white p-3 ${bad ? "border-arm-late" : ""}`}>
      <div className="text-xs text-arm-desc">{label}</div>
      <div className={`text-sm font-semibold ${bad ? "text-arm-late" : ""}`}>{value}</div>
    </div>
  );
}
