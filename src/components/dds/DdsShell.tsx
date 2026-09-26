"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { createContext, useContext, useRef, useState } from "react";
import useSWR from "swr";
import type { SeatInfo } from "@/lib/dds/seat";
import type { FlowInfo } from "@/lib/flow/dds-flow";
import { beep, getJson, postJson, withSeat } from "./client";

export type StateBody = {
  serverNow: string;
  seat: SeatInfo | null;
  op112Running?: boolean;
  flow?: FlowInfo;
  waiting?: number;
};

type Ctx = {
  state: StateBody & { clientOffset: number; seat: SeatInfo };
  seatParam: string | null;
  offset: number;
  refresh: () => void;
};

const DdsContext = createContext<Ctx | null>(null);

export function useDds(): Ctx {
  const ctx = useContext(DdsContext);
  if (!ctx) throw new Error("useDds outside DdsShell");
  return ctx;
}

/**
 * Frame of the ДДС workstation: polls the place about once a second (this also deals new cards),
 * beeps when a new card waits for an answer, and offers «Тренировка без занятия» when there is no place.
 */
export function DdsShell({ children }: { children: React.ReactNode }) {
  const seatParam = useSearchParams().get("seat");
  const lastWaiting = useRef(-1);
  const { data, error, mutate } = useSWR(withSeat("/api/dds/state", seatParam), getJson<StateBody>, {
    refreshInterval: 1000,
    dedupingInterval: 400,
    onSuccess: (d) => {
      const waiting = d.waiting ?? 0;
      if (lastWaiting.current >= 0 && waiting > lastWaiting.current) beep(988, 2);
      lastWaiting.current = waiting;
    },
  });

  if (!data) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-arm-feed text-white">
        {error ? (
          <>
            <span>{error.message}</span>
            <Link href="/login" className="underline">
              Вход в систему
            </Link>
          </>
        ) : (
          "Загрузка рабочего места…"
        )}
      </div>
    );
  }
  if (!data.seat) return <PracticeGate op112Running={!!data.op112Running} onStarted={() => mutate()} />;

  const state = data as Ctx["state"];
  return (
    <DdsContext.Provider value={{ state, seatParam, offset: data.clientOffset, refresh: () => void mutate() }}>
      {children}
    </DdsContext.Provider>
  );
}

function PracticeGate({ op112Running, onStarted }: { op112Running: boolean; onStarted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setBusy(true);
    setError(null);
    const res = await postJson<{ seatId: string }>("/api/dds/practice");
    setBusy(false);
    if (!res.ok) setError(res.message);
    else onStarted();
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-arm-feed p-4">
      <div className="w-full max-w-lg bg-arm-panel p-6 text-arm-dark shadow">
        <h1 className="text-xl font-bold">Рабочее место диспетчера ДДС</h1>
        <p className="mt-2 text-sm text-arm-desc">
          Сейчас нет занятия, где вы работаете на месте ДДС. Можно потренироваться самостоятельно: карточки будут
          приходить на место «Поселение Вороновское», бригады — докладывать по телефону, а по завершении вы увидите разбор.
        </p>
        {op112Running ? (
          <p className="mt-3 text-sm">
            На текущем занятии ваше место — оператор 112:{" "}
            <Link href="/op112" className="font-semibold text-arm-blue underline">
              перейти на место 112
            </Link>
          </p>
        ) : null}
        {error ? <p className="mt-3 text-sm text-arm-late">{error}</p> : null}
        <div className="mt-5 flex flex-wrap gap-3">
          <button
            onClick={start}
            disabled={busy}
            className="bg-arm-blue px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-60"
          >
            {busy ? "Запускаем…" : "Тренировка без занятия"}
          </button>
          <Link href="/" className="border border-arm-dark/30 px-4 py-2 text-sm hover:bg-white">
            В кабинет
          </Link>
        </div>
      </div>
    </div>
  );
}
