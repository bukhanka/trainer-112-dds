"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import type { Op112State } from "@/lib/op112/state";
import { ApiError, fetchState, send, withClock, type StateWithClock } from "./client";
import { CardScreen } from "./CardScreen";
import { WaitingScreen } from "./WaitingScreen";
import { ReviewModal } from "./Review";

export type Notify = (text: string) => void;

/** The 112 place: waiting for a call → incoming call → card → «сохранить» → «отработана» → review. */
export function Workstation() {
  const { data: state, mutate, error } = useSWR<StateWithClock>("/api/op112/state", fetchState, {
    revalidateOnFocus: false,
    refreshInterval: (d) => (d && d.seat && !d.incident ? 5000 : 0),
  });
  const [review, setReview] = useState<{ id: string; number: number | null; next: boolean } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [altHeld, setAltHeld] = useState(false);
  const [starting, setStarting] = useState(false);

  const notify: Notify = useCallback((text) => setToast(text), []);
  const apply = useCallback((s: Op112State) => void mutate(withClock(s), { revalidate: false }), [mutate]);
  const refresh = useCallback(() => void mutate(), [mutate]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // Hold Alt to see the shortcuts, as on the customer's workstation.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        e.preventDefault();
        setAltHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === "Alt") {
        e.preventDefault();
        setAltHeld(false);
      }
    };
    const blur = () => setAltHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  const startTraining = async () => {
    setStarting(true);
    try {
      await apply(await send<Op112State>("/api/op112/training"));
    } catch (e) {
      notify(e instanceof ApiError ? `Не удалось начать тренировку (${e.code})` : "Не удалось начать тренировку");
    } finally {
      setStarting(false);
    }
  };

  let body: React.ReactNode;
  if (error && !state) {
    body = <Centered>Не удалось загрузить рабочее место. Обновите страницу.</Centered>;
  } else if (!state) {
    body = <Centered>Загрузка рабочего места…</Centered>;
  } else if (!state.seat) {
    body = <NoSeat state={state} starting={starting} onStart={startTraining} />;
  } else if (state.incident) {
    body = (
      <CardScreen
        key={state.incident.id}
        state={state}
        incident={state.incident}
        call={state.call}
        apply={apply}
        notify={notify}
        onClosed={(id, number) => setReview({ id, number, next: true })}
      />
    );
  } else {
    body = (
      <WaitingScreen
        state={state}
        paused={Boolean(review)}
        apply={apply}
        refresh={refresh}
        notify={notify}
        onReview={(id, number) => setReview({ id, number, next: false })}
      />
    );
  }

  return (
    <div className={`flex h-screen min-h-[640px] flex-col overflow-hidden bg-arm-gray text-arm-dark ${altHeld ? "hk-on" : ""}`}>
      {body}
      {review && (
        <ReviewModal
          incidentId={review.id}
          number={review.number}
          nextLabel={review.next ? "Ждать следующий вызов" : "Закрыть"}
          onClose={() => setReview(null)}
        />
      )}
      {toast && (
        <div role="status" className="fixed bottom-24 right-6 z-[70] max-w-sm bg-arm-dark px-4 py-3 text-[14px] text-white shadow-xl">
          {toast}
        </div>
      )}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-6 text-[15px] text-arm-dark">{children}</div>;
}

function NoSeat({ state, starting, onStart }: { state: StateWithClock; starting: boolean; onStart: () => void }) {
  return (
    <Centered>
      <div className="w-full max-w-[620px] bg-white p-8 shadow-sm">
        <div className="text-[13px] uppercase tracking-wide text-arm-desc">Рабочее место оператора 112</div>
        <h1 className="mt-1 text-[24px] font-bold">{state.user.fullName}</h1>
        <p className="mt-3 text-[15px] leading-relaxed text-arm-desc">
          Сейчас у вас нет занятия с местом оператора 112. Можно потренироваться самостоятельно: ИИ-заявитель позвонит по учебным билетам, вы
          заполните карточку и оповестите службы, а система сразу покажет разбор — совпадает ли сказанное заявителем с тем, что вы записали.
        </p>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            autoFocus
            disabled={starting}
            onClick={onStart}
            className="bg-arm-orange px-6 py-3 text-[16px] font-bold text-white hover:brightness-95 disabled:opacity-60"
          >
            {starting ? "Готовим место…" : "Тренировка без занятия"}
          </button>
          {state.onDdsSeat && (
            <Link href="/dds" className="border border-arm-dark px-5 py-3 text-[15px] font-semibold hover:bg-[#f3f5f6]">
              Перейти на место ДДС
            </Link>
          )}
          <Link href="/" className="px-3 py-3 text-[14px] text-arm-desc underline underline-offset-2">
            В кабинет
          </Link>
        </div>
        <p className="mt-6 text-[12.5px] text-arm-desc">
          Подсказка: зажмите Alt, чтобы увидеть горячие клавиши. Если преподаватель посадит вас на место 112 в занятии, вызовы пойдут по его заданиям.
        </p>
      </div>
    </Centered>
  );
}
