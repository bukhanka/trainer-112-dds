"use client";

import { useState } from "react";
import useSWR from "swr";
import type { ResultRow } from "@/lib/dds/review";
import { WEIGHT_GROUPS } from "@/lib/scoring/score";
import { getJson, withSeat } from "./client";
import { useDds } from "./DdsShell";
import { ChevronDown, ChevronUp } from "./icons";

type ResultsBody = { rows: ResultRow[]; average: number | null };

const REVIEW_LABEL: Record<string, string> = { PENDING: "предварительно", CONFIRMED: "подтверждено", OVERRIDDEN: "исправлено преподавателем" };

function scoreColor(score: number | null) {
  if (score === null) return "bg-white/20";
  if (score >= 80) return "bg-green-700";
  if (score >= 50) return "bg-amber-600";
  return "bg-arm-late";
}

/** Review of the place's cards: shown during practice and after the lesson, so the trainee sees the mistakes. */
export function ResultsPanel() {
  const { state, seatParam } = useDds();
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data } = useSWR(withSeat("/api/dds/results", seatParam), getJson<ResultsBody>, { refreshInterval: 5000 });
  const rows = data?.rows ?? [];
  if (!rows.length && state.seat.lessonStatus === "RUNNING") return null;
  if (!state.seat.mine && !rows.length) return null;

  return (
    <section className="mt-3 bg-arm-dark/70 text-[13px]">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 px-3 py-2 text-left">
        <b className="text-[15px]">{state.seat.practice && state.seat.mine ? "Самопроверка" : "Разбор"}</b>
        <span className="text-white/80">
          {rows.length ? `карточек: ${rows.length}` : "карточек ещё нет"}
          {data?.average != null ? ` · средний балл ${data.average}` : ""}
          {state.seat.practice && state.seat.mine ? " · это не оценка: оценку ставит преподаватель на занятии" : ""}
        </span>
        <span className="ml-auto">{open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}</span>
      </button>
      {open ? (
        <div className="divide-y divide-white/10 border-t border-white/10">
          {rows.map((r) => (
            <div key={r.id}>
              <button onClick={() => setExpanded(expanded === r.id ? null : r.id)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-white/5">
                <span className={`grid h-8 w-11 shrink-0 place-items-center font-bold ${scoreColor(r.score)}`}>{r.score ?? "—"}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    {r.incidentNumber ? `Карточка ${r.incidentNumber} · ` : ""}
                    {r.title}
                  </span>
                  <span className="block truncate text-[11px] text-white/70">{r.summary}</span>
                </span>
                <span className="shrink-0 text-[11px] text-white/70">{REVIEW_LABEL[r.reviewStatus] ?? r.reviewStatus}</span>
              </button>
              {expanded === r.id ? (
                <ul className="space-y-1.5 bg-black/15 px-4 py-2">
                  {r.criteria.map((c) => (
                    <li key={c.code} className="flex gap-2">
                      <span
                        className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center text-[11px] font-bold ${
                          c.ok === true ? "bg-green-700" : c.ok === false ? "bg-arm-late" : "bg-white/25"
                        }`}
                        title={c.ok === null ? "не применимо" : c.ok ? "выполнено" : "ошибка"}
                      >
                        {c.ok === true ? "✓" : c.ok === false ? "✗" : "–"}
                      </span>
                      <span className="min-w-0">
                        <span className="font-semibold">{c.title}</span>
                        {c.critical && c.ok === false ? <span className="ml-1 text-[11px] text-[#ffb3b3]">критично</span> : null}
                        <span className="ml-1 text-[11px] text-white/60">· {WEIGHT_GROUPS[c.group]}</span>
                        {c.evidence ? <span className="block text-[12px] text-white/85">{c.evidence}</span> : null}
                        {c.ok === false && c.expected ? <span className="block text-[12px] text-[#bfe3ff]">Как правильно: {c.expected}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
