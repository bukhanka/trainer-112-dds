"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR from "swr";
import type { BoardState, CardRow, SeatState } from "@/lib/board/state";
import { formatDuration, formatTime, shortName } from "@/lib/format";

type BoardResponse = BoardState & {
  lesson: { id: string; title: string; status: "DRAFT" | "RUNNING" | "FINISHED"; startedAt: string | null; finishedAt: string | null };
};

async function fetcher(url: string): Promise<BoardResponse> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

/** Ticks every second; timers are drawn locally between the 2-second polls. */
function useClock(skewMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now + skewMs;
}

export function LessonBoard({ lessonId, status, projector = false }: { lessonId: string; status: "DRAFT" | "RUNNING" | "FINISHED"; projector?: boolean }) {
  const [skew, setSkew] = useState(0);
  const [live, setLive] = useState(status);
  // Poll while the lesson runs as the server sees it: a stop in another tab ends the polling here too.
  const { data, error } = useSWR(`/api/teacher/lessons/${lessonId}/board`, fetcher, {
    refreshInterval: live === "RUNNING" ? 2000 : 0,
    revalidateOnFocus: live === "RUNNING",
    keepPreviousData: true,
    onSuccess: (d) => {
      setSkew(new Date(d.now).getTime() - Date.now());
      setLive(d.lesson.status);
    },
  });
  const now = useClock(skew);

  if (!data) {
    return <div className="p-6 text-sm text-arm-desc">{error ? "Не удалось загрузить доску. Повторяю…" : "Загружаю доску класса…"}</div>;
  }

  const running = data.lesson.status === "RUNNING";
  const elapsed = data.lesson.startedAt
    ? ((data.lesson.finishedAt ? new Date(data.lesson.finishedAt).getTime() : now) - new Date(data.lesson.startedAt).getTime()) / 1000
    : null;

  if (projector) return <Projector data={data} now={now} elapsed={elapsed} running={running} offline={Boolean(error)} />;

  const s = data.summary;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2 rounded border border-arm-gray/70 bg-white p-3 text-sm">
        {running ? (
          <span className="inline-flex items-center gap-2 font-medium text-emerald-700">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-600" /> Идёт {formatDuration(elapsed)}
          </span>
        ) : (
          <span className="font-medium text-arm-desc">{data.lesson.status === "FINISHED" ? `Итог занятия · длительность ${formatDuration(elapsed)}` : "Занятие не начато"}</span>
        )}
        <span className="text-arm-desc">
          · мест {s.seats} · работают {s.working}
        </span>
        {s.lateNow > 0 && <Chip red>опаздывают сейчас: {s.lateNow}</Chip>}
        <span className="mx-1 hidden h-5 w-px bg-arm-gray sm:block" />
        <Chip red={s.notNotified > 0}>Не оповещено: {s.notNotified}</Chip>
        <Chip red={s.refused > 0}>Отказ: {s.refused}</Chip>
        <Chip red={s.notFinished > 0}>Не завершено: {s.notFinished}</Chip>
        <Link href={`/teacher/lessons/${lessonId}/attempts?status=PENDING`} className="ml-auto text-arm-blue hover:underline">
          На проверке: {s.pendingReview} из {s.attempts} →
        </Link>
        {error && <span className="w-full text-xs text-red-700">Нет связи с сервером — показаны данные на {formatTime(data.now, true)}</span>}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {data.seats.map((seat) => (
          <SeatTile key={seat.id} seat={seat} now={now} lessonId={lessonId} />
        ))}
      </div>

      <CardsTable cards={data.cards} />
    </div>
  );
}

function Chip({ red, children }: { red?: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold ${red ? "bg-arm-late text-white" : "bg-arm-panel text-arm-desc"}`}
    >
      {children}
    </span>
  );
}

function timerText(seat: SeatState, now: number) {
  if (!seat.timer) return null;
  const sec = (now - new Date(seat.timer.since).getTime()) / 1000;
  const late = seat.timer.normSec != null && sec > seat.timer.normSec;
  return { sec, late };
}

function SeatTile({ seat, now, lessonId }: { seat: SeatState; now: number; lessonId: string }) {
  const t = timerText(seat, now);
  const redFlags = seat.red.notNotified + seat.red.refused + seat.red.notFinished + seat.lateTyping + seat.missedCalls;
  const border = t?.late ? "border-arm-late ring-2 ring-arm-late/40" : seat.current || seat.timer ? "border-arm-blue" : "border-arm-gray/70";
  const is112 = seat.role === "OP112";
  return (
    <article className={`flex min-w-0 flex-col gap-2 rounded border-2 bg-white p-3 ${border}`} aria-label={`${seat.label}: ${seat.studentName}`}>
      <header className="flex items-center gap-2">
        <span className="shrink-0 whitespace-nowrap font-semibold">{seat.label}</span>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold text-white ${is112 ? "bg-arm-orange" : "bg-arm-blue"}`}>{is112 ? "112" : "ДДС"}</span>
        {seat.serviceName && <span className="min-w-0 truncate text-xs text-arm-desc" title={seat.serviceName}>{seat.serviceName}</span>}
        {seat.queue > 0 && <span className="ml-auto shrink-0 whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-900">в очереди {seat.queue}</span>}
      </header>
      <div className="text-base font-semibold leading-tight">{seat.studentName}</div>
      {seat.level && (
        <div className="-mt-1 text-xs text-arm-desc" title="Уровень ученика в роли этого места («как в шахматах») и сложность заданий, которую он подсказывает">
          Уровень <span className="font-semibold tabular-nums text-arm-dark">{seat.level.rating}</span> · задания ≈ {seat.level.difficulty} из 10
          {!seat.level.attempts && " · новичок"}
        </div>
      )}

      <div className="min-h-[3.25rem] rounded bg-arm-panel/70 p-2 text-sm">
        {seat.current ? (
          <>
            <div className="truncate font-medium" title={seat.current.title}>
              № {seat.current.number} · {seat.current.title}
            </div>
            <div className="truncate text-xs text-arm-desc" title={seat.current.address ?? ""}>
              {seat.current.difficulty != null && <>сложность {seat.current.difficulty} · </>}
              {seat.current.address ?? "адрес ещё не указан"} · {seat.current.status}
            </div>
          </>
        ) : seat.timer ? (
          <div className="font-medium">{seat.timer.label === "входящий вызов" ? "Звонит заявитель" : "Разговор с заявителем"}</div>
        ) : (
          <div className="text-arm-desc">{is112 ? "Ждёт вызова" : "Нет открытых карточек"}</div>
        )}
      </div>

      {seat.timer && t && (
        <div className="flex items-baseline gap-2">
          <span className={`font-mono text-3xl font-bold tabular-nums ${t.late ? "text-arm-late" : "text-arm-dark"}`}>{formatDuration(t.sec)}</span>
          <span className="text-xs text-arm-desc">
            {seat.timer.label}
            {seat.timer.normSec != null && <> · норматив {formatDuration(seat.timer.normSec)}</>}
          </span>
        </div>
      )}

      <dl className="grid grid-cols-3 gap-1 text-center text-xs">
        {(is112 ? ["Вызовов", "Сохранил", "Сдал"] : ["Открыл", "Ответил", "Сдал"]).map((label, i) => (
          <div key={label} className="rounded border border-arm-gray/60 py-1">
            <dt className="text-arm-desc">{label}</dt>
            <dd className="text-base font-semibold tabular-nums">{[seat.counts.opened, seat.counts.answered, seat.counts.submitted][i]}</dd>
          </div>
        ))}
      </dl>

      {redFlags > 0 && (
        <div className="flex flex-wrap gap-1">
          {seat.red.notNotified > 0 && <Chip red>Не оповещено {seat.red.notNotified}</Chip>}
          {seat.red.refused > 0 && <Chip red>Отказ {seat.red.refused}</Chip>}
          {seat.red.notFinished > 0 && <Chip red>Не завершено {seat.red.notFinished}</Chip>}
          {seat.lateTyping > 0 && <Chip red>Поздно сохранено {seat.lateTyping}</Chip>}
          {seat.missedCalls > 0 && <Chip red>Пропущено вызовов {seat.missedCalls}</Chip>}
        </div>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-arm-gray/50 pt-2 text-xs">
        <span className={seat.failedChecks ? "font-semibold text-red-700" : seat.attempts ? "text-emerald-700" : "text-arm-desc"}>
          {seat.failedChecks ? `Ошибок: ${seat.failedChecks}` : seat.attempts ? "Ошибок нет" : "Попыток ещё нет"}
        </span>
        {seat.pendingReview > 0 && (
          <Link href={`/teacher/lessons/${lessonId}/attempts?seat=${seat.id}`} className="text-arm-blue hover:underline">
            на проверке {seat.pendingReview}
          </Link>
        )}
        {seat.topErrors.length > 0 && <span className="w-full text-arm-desc">Чаще всего: {seat.topErrors.join("; ").toLowerCase()}</span>}
      </div>
    </article>
  );
}

function CardsTable({ cards }: { cards: CardRow[] }) {
  if (!cards.length) return null;
  return (
    <section className="rounded border border-arm-gray/70 bg-white">
      <h2 className="border-b border-arm-gray/60 px-3 py-2 text-base font-semibold">Карточки занятия · как у отдела контроля</h2>
      <ul className="divide-y divide-arm-gray/50">
        {cards.map((c) => {
          const red = c.control.some((x) => x.red);
          return (
            <li key={c.id} className={`grid gap-2 px-3 py-2 text-sm md:grid-cols-[7rem_1fr_minmax(0,1.3fr)_10rem] ${red ? "bg-red-50/60" : ""}`}>
              <div>
                <div className="font-mono font-semibold">{c.number}</div>
                <div className="text-xs text-arm-desc">
                  {formatTime(c.createdAt, true)}
                  {c.author && <> · {c.author}</>}
                </div>
              </div>
              <div className="min-w-0">
                <div className="font-medium">
                  {c.title}
                  {c.difficulty != null && <span className="ml-1.5 whitespace-nowrap text-xs font-normal text-arm-desc">· сложность {c.difficulty}</span>}
                </div>
                <div className="truncate text-xs text-arm-desc" title={c.address ?? ""}>
                  {c.address ?? "—"}
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                {c.plates.map((p, i) => (
                  <span
                    key={i}
                    title={p.phoneOnly ? "Оповещается только по телефону" : undefined}
                    className={`rounded px-1.5 py-0.5 text-xs ${p.phoneOnly ? "bg-arm-plate-gray/30 text-arm-desc" : p.seat ? "bg-arm-blue/10 text-arm-dark" : "bg-arm-panel text-arm-desc"}`}
                  >
                    <span className="font-medium">{p.name}</span>
                    {p.seat && <span className="text-arm-blue"> · {p.seat}</span>} ·{" "}
                    <span className={p.late ? "font-semibold text-arm-late" : ""}>{p.status}</span>
                  </span>
                ))}
              </div>
              <div className="flex flex-wrap content-start gap-1 md:justify-end">
                {c.control.map((x) => (
                  <Chip key={x.label} red={x.red}>
                    {x.label}
                  </Chip>
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Projector / external monitor: large tiles, only what is readable from the back of the room. */
function Projector({ data, now, elapsed, running, offline }: { data: BoardResponse; now: number; elapsed: number | null; running: boolean; offline: boolean }) {
  const s = data.summary;
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-[#1d2226] p-4 text-white sm:p-6">
      <div className="mb-4 flex flex-wrap items-center gap-4">
        <h1 className="text-2xl font-bold sm:text-3xl">{data.lesson.title}</h1>
        <span className={`font-mono text-2xl font-bold tabular-nums sm:text-3xl ${running ? "text-emerald-400" : "text-white/60"}`}>{formatDuration(elapsed)}</span>
        <div className="flex flex-wrap gap-2 text-lg">
          <BigChip red={s.notNotified > 0}>Не оповещено {s.notNotified}</BigChip>
          <BigChip red={s.refused > 0}>Отказ {s.refused}</BigChip>
          <BigChip red={s.notFinished > 0}>Не завершено {s.notFinished}</BigChip>
        </div>
        {offline && <span className="text-sm text-red-300">нет связи</span>}
        <Link href={`/teacher/lessons/${data.lesson.id}`} className="ml-auto rounded border border-white/30 px-3 py-1 text-sm text-white/80 hover:bg-white/10" aria-label="Выйти из режима проектора">
          ✕ Выйти
        </Link>
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(17rem, 1fr))" }}>
        {data.seats.map((seat) => {
          const t = timerText(seat, now);
          const red = seat.red.notNotified + seat.red.refused + seat.red.notFinished + seat.lateTyping + seat.missedCalls;
          return (
            <div key={seat.id} className={`min-w-0 rounded-lg border-4 p-4 ${t?.late ? "border-arm-late bg-arm-late/15" : seat.timer ? "border-arm-blue bg-white/5" : "border-white/15 bg-white/5"}`}>
              <div className="flex items-center gap-2 text-xl font-bold">
                {seat.label}
                <span className={`rounded px-2 text-base ${seat.role === "OP112" ? "bg-arm-orange" : "bg-arm-blue"}`}>{seat.role === "OP112" ? "112" : "ДДС"}</span>
              </div>
              <div className="truncate text-2xl font-semibold">{shortName(seat.studentName)}</div>
              <div className={`mt-2 font-mono text-5xl font-bold tabular-nums ${t?.late ? "text-red-400" : "text-white"}`}>{t ? formatDuration(t.sec) : "—"}</div>
              <div className="truncate text-base text-white/70">{seat.current ? seat.current.title : seat.timer ? seat.timer.label : seat.role === "OP112" ? "ждёт вызова" : "нет карточек"}</div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-base">
                <span className="text-white/70">сдал {seat.counts.submitted}</span>
                {seat.queue > 0 && <span className="rounded bg-amber-500/30 px-2">очередь {seat.queue}</span>}
                {red > 0 && <span className="rounded bg-arm-late px-2 font-semibold">красных {red}</span>}
                {seat.failedChecks > 0 && <span className="text-red-300">ошибок {seat.failedChecks}</span>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BigChip({ red, children }: { red?: boolean; children: React.ReactNode }) {
  return <span className={`rounded px-3 py-1 font-semibold ${red ? "bg-arm-late text-white" : "bg-white/10 text-white/70"}`}>{children}</span>;
}
