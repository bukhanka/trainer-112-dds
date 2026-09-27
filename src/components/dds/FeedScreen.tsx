"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useDeferredValue, useState } from "react";
import useSWR from "swr";
import { crewSecondsLeft } from "@/lib/dds/crew";
import { dateParts, fmtDateShort, fmtDateTime, fmtDuration } from "@/lib/dds/format";
import type { FeedRow } from "@/lib/dds/view";
import { getJson, postJson, useNow, withSeat } from "./client";
import { ClockBlock } from "./ClockBlock";
import { useDds } from "./DdsShell";
import { ResultsPanel } from "./ResultsPanel";
import { Bolt, Bookmark, Chain, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clipboard, Hourglass, MapPinOff, Search, Stopwatch } from "./icons";

type FeedBody = { rows: FeedRow[]; total: number; page: number; pages: number; size: number };

// Column layout of a feed record, left to right as in the customer's system.
const GRID =
  "grid grid-cols-[30px_30px_28px_28px_64px_48px_40px_78px_66px_74px_minmax(140px,1fr)_46px_minmax(260px,2.2fr)_150px_38px] gap-[2px]";

const SHOW_OPTIONS = [
  { value: "all", label: "выберите что показать" },
  { value: "waiting", label: "ждут ответа" },
  { value: "work", label: "в работе" },
  { value: "closed", label: "закрытые" },
];

export function FeedScreen() {
  const { state, seatParam, offset } = useDds();
  const seat = state.seat;
  const router = useRouter();
  const [q, setQ] = useState("");
  const query = useDeferredValue(q.trim());
  const [show, setShow] = useState("all");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [collapsed, setCollapsed] = useState(false);
  const [previews, setPreviews] = useState<Record<string, boolean>>({});

  const key = withSeat(`/api/dds/feed?page=${page}&size=${size}&show=${show}&q=${encodeURIComponent(query)}`, seatParam);
  const { data } = useSWR(key, getJson<FeedBody>, { refreshInterval: 1200, keepPreviousData: true, dedupingInterval: 500 });
  const now = useNow(offset);

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const from = total ? (data!.page - 1) * data!.size + 1 : 0;
  const to = total ? Math.min(total, data!.page * data!.size) : 0;

  const open = (n: number) => router.push(withSeat(`/dds/incident/${n}`, seatParam));

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex flex-col lg:flex-row">
        <div className="flex-1 bg-arm-header px-4 pb-3 pt-5 text-arm-dark">
          <label className="flex items-end border-b border-arm-dark/80">
            <span className="sr-only">Поиск происшествий</span>
            <input
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setPage(1);
              }}
              placeholder="Поиск происшествий"
              className="min-w-0 flex-1 bg-transparent pb-1 text-[26px] leading-9 text-[#1f2326] outline-none placeholder:text-[#1f2326] sm:text-[30px]"
            />
            <Search className="mb-2 h-7 w-7" />
          </label>
          <div className="mt-2 flex items-center justify-between text-[12px]">
            <span className="flex items-center gap-1 text-[#1f2326]" title="Поиск по номеру, адресу, типу и описанию">
              расширенный по параметрам <ChevronDown className="h-3.5 w-3.5" />
            </span>
            <button
              onClick={() => {
                setQ("");
                setShow("all");
                setPage(1);
              }}
              className="border border-arm-dark/40 px-2 py-0.5 text-arm-desc hover:bg-white"
            >
              сбросить
            </button>
          </div>
        </div>
        <ClockBlock seat={seat} offset={offset} />
      </header>

      <main className="flex-1 bg-arm-feed px-3 pb-8 text-white sm:px-4">
        <SeatStrip />
        {state.seat.practice || !state.seat.mine ? (
          <ResultsPanel />
        ) : state.seat.lessonStatus === "FINISHED" ? (
          <div className="mt-3 bg-arm-dark/60 px-3 py-2 text-[13px]">
            Разбор занятия появится в кабинете после проверки преподавателем:{" "}
            <Link href="/student/results" className="font-semibold underline">
              Мои результаты
            </Link>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-4">
          <button onClick={() => setCollapsed((c) => !c)} className="flex items-center gap-2 pl-4 text-[19px] font-bold sm:pl-8">
            Список происшествий {collapsed ? <ChevronDown className="h-5 w-5" /> : <ChevronUp className="h-5 w-5" />}
          </button>
          <div className="flex items-center gap-4 text-[13px]">
            <span className="flex items-center gap-1.5" title="Карточки без ответа «Принята / Не принята»">
              <span className="grid h-4 w-4 place-items-center rounded-full bg-white/80 text-[11px] font-bold text-arm-feed">!</span>
              уведомления
              {state.waiting ? <b className="rounded bg-arm-late px-1.5 text-white">{state.waiting}</b> : null}
            </span>
            <select
              value={show}
              onChange={(e) => {
                setShow(e.target.value);
                setPage(1);
              }}
              className="w-[200px] border border-white/60 bg-transparent px-2 py-1 text-[13px] text-white outline-none [&>option]:text-arm-dark"
            >
              {SHOW_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {collapsed ? null : (
          <div className="mt-2 overflow-x-auto">
            <div className="min-w-[1180px]">
              <div className={`${GRID} px-0 pb-1 text-[12px] text-white/90`}>
                <span />
                <span>Связи</span>
                <span />
                <span className="text-center">ЧС</span>
                <span />
                <span className="text-center">Опер.</span>
                <span className="text-center">АРМ</span>
                <span className="text-center">Номер</span>
                <span className="text-center">Дата ↓</span>
                <span className="text-center">Время</span>
                <span>Тип происшествия</span>
                <span>Постр.</span>
                <span>Адрес</span>
                <span>Статус службы</span>
                <span />
              </div>
              {rows.map((r) => (
                <FeedRecord
                  key={r.id}
                  row={r}
                  now={now}
                  ackSec={seat.ackSec}
                  workSec={seat.workSec}
                  live={seat.lessonStatus === "RUNNING"}
                  preview={!!previews[r.id]}
                  onPreview={() => setPreviews((p) => ({ ...p, [r.id]: !p[r.id] }))}
                  onOpen={() => open(r.number)}
                />
              ))}
              {data && !rows.length ? <EmptyFeed filtered={!!query || show !== "all"} /> : null}
            </div>
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-[13px] text-white/90">
          <label className="flex items-center gap-1">
            Страница:
            <select value={data?.page ?? 1} onChange={(e) => setPage(Number(e.target.value))} className="bg-transparent outline-none [&>option]:text-arm-dark">
              {Array.from({ length: data?.pages ?? 1 }, (_, i) => (
                <option key={i + 1} value={i + 1}>
                  {i + 1}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1">
            Записей на странице:
            <select
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setPage(1);
              }}
              className="bg-transparent outline-none [&>option]:text-arm-dark"
            >
              {[10, 20, 50].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <b>
            {from}-{to} из {total}
          </b>
          <button aria-label="Предыдущая страница" disabled={(data?.page ?? 1) <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))} className="disabled:opacity-40">
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            aria-label="Следующая страница"
            disabled={(data?.page ?? 1) >= (data?.pages ?? 1)}
            onClick={() => setPage((p) => p + 1)}
            className="disabled:opacity-40"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </main>
    </div>
  );
}

function Cell({ className = "", children, title }: { className?: string; children?: React.ReactNode; title?: string }) {
  return (
    <div title={title} className={`flex min-h-[30px] min-w-0 items-center justify-center bg-arm-dark text-[12px] ${className}`}>
      {children}
    </div>
  );
}

function TimerCell({ row, now, ackSec, workSec, live }: { row: FeedRow; now: number; ackSec: number; workSec: number; live: boolean }) {
  const added = Date.parse(row.ownAddedAt);
  if (!row.answeredAt) {
    const sec = now ? (now - added) / 1000 : 0;
    const over = sec > ackSec;
    return (
      <Cell
        className={over ? "bg-arm-late! font-bold text-white" : "text-white"}
        title={over ? `Норматив ${ackSec} с на «Принята / Не принята» превышен` : `С момента «Добавлена». Норматив ${ackSec} с`}
      >
        <Stopwatch className="mr-1 h-4 w-4 shrink-0" />
        <span className="tabular-nums">{fmtDuration(sec)}</span>
      </Cell>
    );
  }
  if (live && row.crew && !row.crew.sentAt) {
    // After «Принята»: time left to work the card (send a crew or close it), counted from «Добавлена» like the 30 seconds.
    const left = now ? crewSecondsLeft(row.crew, now) : workSec;
    const late = left < 0;
    return (
      <Cell
        className={late ? "bg-arm-late! font-bold text-white" : "text-white"}
        title={
          late
            ? `Норматив отработки ${fmtDuration(workSec)} от «Добавлена» превышен`
            : `Осталось на отработку: отправьте наряд или закройте карточку. Норматив ${fmtDuration(workSec)} от «Добавлена»`
        }
      >
        <Hourglass className="mr-1 h-4 w-4 shrink-0" />
        <span className="tabular-nums">{late ? `+${fmtDuration(-left)}` : fmtDuration(left)}</span>
      </Cell>
    );
  }
  const sec = (Date.parse(row.answeredAt) - added) / 1000;
  return (
    <Cell className={row.answerLate ? "text-arm-late" : "text-white/55"} title={row.answerLate ? "Ответ с опозданием" : "Время ответа службы"}>
      <Stopwatch className="mr-1 h-4 w-4 shrink-0" />
      <span className="tabular-nums">{fmtDuration(sec)}</span>
    </Cell>
  );
}

function FeedRecord(props: { row: FeedRow; now: number; ackSec: number; workSec: number; live: boolean; preview: boolean; onPreview: () => void; onOpen: () => void }) {
  const { row, now, ackSec, workSec, live, preview } = props;
  const t = dateParts(row.savedAt);
  const unopened = row.ownStatus === "ADDED";
  return (
    <div className="mt-2">
      <div
        role="button"
        tabIndex={0}
        onClick={props.onOpen}
        onKeyDown={(e) => e.key === "Enter" && props.onOpen()}
        className={`${GRID} cursor-pointer hover:brightness-125`}
        title="Открыть карточку"
      >
        <Cell>
          <button
            aria-label="Предпросмотр"
            onClick={(e) => {
              e.stopPropagation();
              props.onPreview();
            }}
          >
            {preview ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
        </Cell>
        <Cell title={row.linkedTo ? `Связана с карточкой № ${row.linkedTo} (главная): повторный вызов о том же происшествии` : undefined}>
          {row.linkedTo ? <Chain className="h-4 w-4 text-white" title={`Связана с № ${row.linkedTo}`} /> : null}
        </Cell>
        <Cell>
          <Bookmark className="h-5 w-4 text-[#8e979d]" />
        </Cell>
        <Cell>
          <Bolt className={`h-4 w-4 ${row.important ? "text-yellow-300" : "text-white"}`} />
        </Cell>
        <TimerCell row={row} now={now} ackSec={ackSec} workSec={workSec} live={live} />
        <Cell className={row.operatorNo === "0" ? "bg-arm-bordo!" : ""}>{row.operatorNo}</Cell>
        <Cell>{row.armNo}</Cell>
        <Cell className={unopened ? "font-bold" : ""}>{row.number}</Cell>
        <Cell>{fmtDateShort(row.savedAt)}</Cell>
        <Cell className="text-[16px] font-bold">
          {t.HH}:{t.MM}
          <sup className="ml-px text-[10px] font-normal">{t.SS}</sup>
        </Cell>
        <Cell className="justify-start! truncate px-1.5 text-[16px] font-bold">
          <span className="truncate" title={row.cardType}>
            {row.cardType}
          </span>
        </Cell>
        <Cell>{row.victims ? "Есть" : "Нет"}</Cell>
        <Cell className="justify-between! gap-2 px-2 font-bold">
          <span className="truncate" title={row.address}>
            {row.address}
          </span>
          <MapPinOff className="h-4 w-4 shrink-0 text-arm-orange" />
        </Cell>
        <Cell className={`justify-start! px-2 ${unopened ? "font-bold text-white" : "text-[#c9ced1]"}`}>{row.ownLabel}</Cell>
        <Cell>
          <Clipboard className="h-4 w-4 text-white" />
        </Cell>
      </div>
      {row.description ? (
        <div className="flex min-w-0 items-baseline gap-2 bg-arm-desc px-2 py-1 text-[12px]">
          <span className="w-[86px] shrink-0">Описание:</span>
          <span className="shrink-0 text-[#c9ced1]">
            {row.description.at ? fmtDateTime(row.description.at) : ""} {row.description.author}
          </span>
          <span className="shrink-0">-</span>
          <span className="truncate text-[14px] text-white">{row.description.text}</span>
        </div>
      ) : null}
      {preview ? (
        <div className="space-y-0.5 bg-[#3b4348] px-3 py-2 text-[12px] leading-5">
          <div>
            <b>Службы:</b> {row.preview.services || "—"}
          </div>
          <div>
            <b>Заявитель:</b> {row.preview.caller || "—"}
          </div>
          <div>
            <b>Информация:</b> {row.preview.info || "—"}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function EmptyFeed({ filtered }: { filtered: boolean }) {
  const { state } = useDds();
  const next = state.flow?.nextCardInSec;
  let text = "Карточек пока нет.";
  if (filtered) text = "Ничего не найдено — измените поиск или нажмите «сбросить».";
  else if (state.flow?.noScenarios) text = "Нет одобренных сценариев для этого занятия — карточки не приходят. Обратитесь к преподавателю.";
  else if (state.flow?.paused) text = "Карточек пока нет: администратор приостановил поток новых карточек.";
  else if (state.flow?.running && next != null) text = `Карточек пока нет. Первая придёт через ${fmtDuration(next)}.`;
  return <div className="mt-6 text-center text-[14px] text-white/85">{text}</div>;
}

/** Line under the header: practice / finished lesson / read-only watching, with the next card countdown. */
function SeatStrip() {
  const { state, refresh } = useDds();
  const { seat, flow } = state;
  const [busy, setBusy] = useState(false);

  async function startAgain() {
    setBusy(true);
    await postJson("/api/dds/practice");
    setBusy(false);
    refresh();
  }

  if (seat.readOnly) {
    const again = seat.mine && seat.lessonStatus === "FINISHED";
    return (
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 bg-arm-dark/60 px-3 py-2 text-[13px]">
        <span>
          {seat.lessonStatus === "FINISHED" ? "Занятие завершено — карточки открыты только для просмотра." : "Просмотр места обучающегося: изменения недоступны."}{" "}
          <span className="text-white/70">{seat.lessonTitle}</span>
        </span>
        {again ? (
          <button onClick={startAgain} disabled={busy} className="ml-auto border border-white/60 px-2 py-0.5 hover:bg-white/10 disabled:opacity-50">
            {seat.practice ? "Новая тренировка" : "Тренировка без занятия"}
          </button>
        ) : null}
      </div>
    );
  }
  if (!seat.practice && !seat.hints) return null;

  async function finish() {
    if (!confirm("Завершить тренировку? Незакрытые карточки попадут в разбор как есть.")) return;
    setBusy(true);
    await postJson("/api/dds/practice/finish");
    setBusy(false);
    refresh();
  }

  const next = flow?.nextCardInSec;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 bg-arm-dark/60 px-3 py-2 text-[13px]">
      <span>
        {seat.practice ? "Самостоятельная тренировка" : seat.lessonTitle} · место «{seat.serviceShort}». Карточки приходят каждые {seat.tempoSec} с,
        в очереди не больше {seat.maxQueue}. На «Принята / Не принята» — {seat.ackSec} с, на отработку (отправить наряд или закрыть карточку) — {fmtDuration(seat.workSec)} от «Добавлена».
      </span>
      <span className="text-white/80">
        {flow?.noScenarios
          ? "Нет одобренных сценариев."
          : flow?.paused
            ? "Новые карточки приостановлены администратором."
            : next != null
              ? `Следующая карточка через ${fmtDuration(next)}.`
              : flow && flow.queue >= flow.maxQueue
                ? "Очередь заполнена: закройте карточку, чтобы пришла новая."
                : ""}
      </span>
      {seat.practice ? (
        <button onClick={finish} disabled={busy} className="ml-auto border border-white/60 px-2 py-0.5 hover:bg-white/10 disabled:opacity-50">
          Завершить тренировку
        </button>
      ) : null}
    </div>
  );
}
