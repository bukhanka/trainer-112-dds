"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import useSWR from "swr";
import type { ServicesStatus } from "@/lib/admin/services-status";
import type { ServiceKey, SwitchState } from "@/lib/admin/services";
import { formatDateTime, formatTime } from "@/lib/format";

const fetcher = (url: string) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(r.status)));

/** What a stop does, asked before stopping: the administrator sees the consequence, not just a button. */
const STOP_CONFIRM: Record<ServiceKey, string> = {
  scheduler: "Приостановить планировщик? Пока он на паузе, не делаются резервные копии, проверка целостности и очистка журнала.",
  ai: "Выключить модели ИИ? Заявители будут отвечать по правилам, речь — распознавать и озвучивать браузер, ИИ-проверки станут «не применимо».",
  ddsFlow: "Приостановить поток карточек ДДС? Во всех идущих занятиях перестанут приходить новые карточки; начатые карточки и звонки продолжатся.",
};

export function ServicesPanel({ initial }: { initial: ServicesStatus }) {
  const router = useRouter();
  const { data = initial, error, mutate } = useSWR<ServicesStatus>("/api/admin/services", fetcher, { refreshInterval: 5000, fallbackData: initial });
  const [busy, setBusy] = useState<ServiceKey | null>(null);
  const [failure, setFailure] = useState("");

  async function toggle(service: ServiceKey, on: boolean) {
    if (!on && !window.confirm(STOP_CONFIRM[service])) return;
    setBusy(service);
    setFailure("");
    try {
      const res = await fetch("/api/admin/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ service, on }) });
      if (!res.ok) throw new Error(String(res.status));
      await mutate(await res.json(), { revalidate: false });
      router.refresh(); // the banner at the top of the page follows the switch
    } catch {
      setFailure("Не удалось переключить службу — нет связи с сервером. Попробуйте ещё раз.");
    } finally {
      setBusy(null);
    }
  }

  const { scheduler, ai, ddsFlow, database, server } = data;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="services-title">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="services-title" className="text-lg font-semibold">
          Службы
        </h2>
        <span className="text-xs text-arm-desc">
          состояние обновляется раз в 5 с{error ? " · нет связи с сервером" : ""} · пуск и остановка пишутся в журнал
        </span>
      </div>
      {data.demo && (
        <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Демо-стенд: остановленная служба сама запустится через {data.demoOffMinutes} мин, а ночной сброс в {scheduler.resetAt} запускает всё — чтобы
          один проверяющий не оставил стенд выключенным для остальных.
        </p>
      )}
      {failure && <p className="text-sm text-arm-late">{failure}</p>}
      <div className="grid gap-3 lg:grid-cols-2">
        <ServiceCard
          title="Планировщик"
          what="Резервные копии, проверка целостности, очистка журнала и старых копий"
          state={scheduler}
          status={
            !scheduler.on
              ? stoppedText(scheduler, "на паузе")
              : scheduler.alive
                ? `работает · последний проход ${formatTime(scheduler.heartbeatAt, true)}`
                : "не отвечает: нет прохода дольше 3 мин"
          }
          bad={scheduler.on && !scheduler.alive}
          action={{ on: scheduler.on, stop: "Приостановить", start: "Возобновить" }}
          busy={busy === "scheduler"}
          onToggle={(on) => toggle("scheduler", on)}
        >
          <Fact label="Резервная копия">
            каждый день в {scheduler.backupAt} · последняя{" "}
            {scheduler.lastBackup ? `${formatDateTime(scheduler.lastBackup.at)} (${scheduler.lastBackup.status === "ok" ? "успешно" : scheduler.lastBackup.status === "running" ? "идёт" : "ошибка"})` : "— ещё не было"}
          </Fact>
          <Fact label="Проверка целостности">каждый день в {scheduler.integrityAt}</Fact>
          <Fact label="Очистка">раз в час: журнал старше срока хранения, копии старше срока, истёкшие сессии</Fact>
          {scheduler.resetAt && <Fact label="Сброс демо-стенда">каждую ночь в {scheduler.resetAt} — выполняется и на паузе</Fact>}
          {!scheduler.alive && scheduler.on && (
            <p className="text-xs text-arm-late">Планировщик работает внутри сервера приложения. Если он не отвечает — перезапустите сервер (ниже).</p>
          )}
        </ServiceCard>

        <ServiceCard
          title="Модели ИИ"
          what="Реплики заявителей и бригад, ИИ-проверки, черновики разбора, распознавание и синтез речи"
          state={ai}
          status={!ai.on ? stoppedText(ai, "выключены") : ai.config.llm === "mock" ? "не подключены — отвечают правила" : "работают"}
          action={{ on: ai.on, stop: "Выключить", start: "Включить" }}
          busy={busy === "ai"}
          onToggle={(on) => toggle("ai", on)}
        >
          {!ai.on && <Fact label="Сейчас">отвечают правила, речь распознаёт и озвучивает браузер, ИИ-проверки — «не применимо»</Fact>}
          <Fact label="Языковая модель">{shownModel(ai.config.llm, "отвечают правила")}</Fact>
          <Fact label="Распознавание речи">{shownModel(ai.config.stt, "распознаёт браузер")}</Fact>
          <Fact label="Синтез речи">{shownModel(ai.config.tts, "озвучивает браузер")}</Fact>
          <Fact label="Сегодня">
            обращений к моделям {ai.today.calls} · ответов по правилам {ai.today.rules} · сбоев {ai.today.failed}
          </Fact>
          <p className="text-xs text-arm-desc">
            Модели задаются в .env при установке: на демо-стенде — облачные, в контуре учебного центра — локальные на своём сервере, данные наружу не уходят.
          </p>
        </ServiceCard>

        <ServiceCard
          title="Поток карточек ДДС"
          what="Новые карточки на местах ДДС во всех идущих занятиях и самостоятельных тренировках"
          state={ddsFlow}
          status={!ddsFlow.on ? stoppedText(ddsFlow, "приостановлен") : ddsFlow.runningLessons ? "идёт" : "работает · занятий сейчас нет"}
          action={{ on: ddsFlow.on, stop: "Приостановить", start: "Возобновить" }}
          busy={busy === "ddsFlow"}
          onToggle={(on) => toggle("ddsFlow", on)}
        >
          <Fact label="Сейчас">
            идёт занятий {ddsFlow.runningLessons} · мест ДДС {ddsFlow.ddsPlaces}
          </Fact>
          <Fact label="Карточек ДДС за час">{ddsFlow.cardsLastHour}</Fact>
          <p className="text-xs text-arm-desc">На паузе начатые карточки, таймеры и звонки бригад продолжаются — не приходят только новые.</p>
        </ServiceCard>

        <ServiceCard
          title="База данных"
          what="PostgreSQL: пользователи, занятия, оценки, справочники, журнал"
          status={database.ok ? `работает · ответ ${database.ms} мс` : "недоступна"}
          bad={!database.ok}
        >
          {database.ok && (
            <Fact label="Сейчас">
              PostgreSQL {database.version ?? "—"} · {database.sizeMb ?? "—"} МБ · подключений {database.connections ?? "—"}
            </Fact>
          )}
          <Manual>
            Из браузера не останавливается: без базы не открыть и эту страницу. На сервере — <code>docker compose stop db</code> и{" "}
            <code>docker compose start db</code>.
          </Manual>
        </ServiceCard>

        <ServiceCard title="Сервер приложения" what="Страницы и API. В Docker процессов несколько (APP_WORKERS) — здесь тот, что ответил" status={`работает ${server.uptimeMin} мин`}>
          <Fact label="Процесс">
            № {server.pid} · Node {server.node} · память {server.memoryMb} МБ
          </Fact>
          <Manual>
            Из браузера не останавливается: остановка сервера закрыла бы эту страницу. На сервере — <code>docker compose --profile app restart app</code>{" "}
            (перезапуск) и <code>docker compose --profile app stop app</code>.
          </Manual>
        </ServiceCard>
      </div>
    </section>
  );
}

function stoppedText(s: SwitchState, what: string): string {
  const who = s.by ? ` · ${s.by}` : "";
  const since = s.at ? ` с ${formatTime(s.at)}` : "";
  return `${what}${since}${who}${s.until ? ` · запустится само в ${formatTime(s.until)}` : ""}`;
}

function ServiceCard({
  title,
  what,
  status,
  state,
  bad,
  action,
  busy,
  onToggle,
  children,
}: {
  title: string;
  what: string;
  status: string;
  state?: SwitchState;
  bad?: boolean;
  action?: { on: boolean; stop: string; start: string };
  busy?: boolean;
  onToggle?: (on: boolean) => void;
  children?: ReactNode;
}) {
  const stopped = state ? !state.on : false;
  const tone = bad ? "border-arm-late" : stopped ? "border-amber-400" : "";
  const dot = bad ? "bg-arm-late" : stopped ? "bg-amber-500" : "bg-emerald-600";
  return (
    <article className={`flex flex-col gap-2 rounded border bg-white p-3 text-sm ${tone}`}>
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold">{title}</h3>
          <p className="text-xs text-arm-desc">{what}</p>
        </div>
        {action && onToggle && (
          <button
            onClick={() => onToggle(!action.on)}
            disabled={busy}
            className={`h-8 shrink-0 px-3 text-sm disabled:opacity-60 ${action.on ? "border border-arm-plate-gray bg-white hover:bg-arm-panel" : "bg-arm-blue text-white"}`}
          >
            {busy ? "…" : action.on ? action.stop : action.start}
          </button>
        )}
      </div>
      <p className={`flex items-start gap-2 font-medium ${bad ? "text-arm-late" : stopped ? "text-amber-800" : ""}`} role="status">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden />
        <span>{status}</span>
      </p>
      <div className="flex flex-col gap-1">{children}</div>
    </article>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <dl className="grid gap-x-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="text-xs text-arm-desc">{label}</dt>
      <dd className="break-words">{children}</dd>
    </dl>
  );
}

function Manual({ children }: { children: ReactNode }) {
  return <p className="rounded bg-arm-panel px-2 py-1.5 text-xs text-arm-desc [&_code]:font-mono [&_code]:whitespace-nowrap [&_code]:text-arm-dark">{children}</p>;
}

/** «mock» from the settings means «no model configured»: say what works instead. */
function shownModel(value: string, fallback: string): string {
  return value === "mock" ? `не подключена — ${fallback}` : value;
}
