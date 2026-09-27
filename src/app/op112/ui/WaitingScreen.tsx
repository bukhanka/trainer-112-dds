"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Op112State } from "@/lib/op112/state";
import { ApiError, send, type StateWithClock } from "./client";
import { TopBar } from "./TopBar";
import { IconPhone } from "./icons";
import { dateTime, hhmm, mmss } from "./format";
import type { Notify } from "./Workstation";

/** A short two-tone ring while a call waits; silent if the browser blocks sound. */
function useRingTone(on: boolean) {
  useEffect(() => {
    if (!on) return;
    let ctx: AudioContext | null = null;
    try {
      ctx = new AudioContext();
    } catch {
      return;
    }
    const beep = () => {
      if (!ctx || ctx.state === "closed") return;
      const t = ctx.currentTime;
      for (const [i, f] of [440, 480].entries()) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05, t + 0.05 + i * 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
        o.connect(g).connect(ctx.destination);
        o.start(t);
        o.stop(t + 0.95);
      }
    };
    beep();
    const id = setInterval(beep, 2600);
    return () => {
      clearInterval(id);
      ctx?.close().catch(() => undefined);
    };
  }, [on]);
}

export function WaitingScreen(p: {
  state: StateWithClock;
  paused: boolean;
  apply: (s: Op112State) => void;
  refresh: () => void;
  notify: Notify;
  onReview: (id: string, number: number | null) => void;
}) {
  const [noScenarios, setNoScenarios] = useState(false);
  const [answering, setAnswering] = useState(false);
  const [retry, setRetry] = useState(0);
  const ringing = p.state.call?.status === "RINGING" ? p.state.call : null;
  const ringingId = ringing?.id ?? null;
  const { refresh, paused } = p;
  useRingTone(Boolean(ringing));

  // A new call comes a few seconds after the place becomes free.
  useEffect(() => {
    if (ringingId || paused || noScenarios) return;
    const t = setTimeout(
      () => {
        send("/api/op112/ring")
          .then(() => refresh())
          .catch((e) => {
            if (e instanceof ApiError && e.code === "no_scenarios") setNoScenarios(true);
            else setRetry((n) => n + 1); // a network hiccup: try again a bit later
          });
      },
      (retry ? 5000 : 2000) + Math.random() * 2500,
    );
    return () => clearTimeout(t);
  }, [ringingId, paused, noScenarios, refresh, retry]);

  const answer = async () => {
    if (!ringing || answering) return;
    setAnswering(true);
    try {
      p.apply(await send<Op112State>(`/api/op112/calls/${ringing.id}/answer`));
    } catch {
      p.notify("Не удалось принять вызов");
    } finally {
      // The screen switches to the card on success; if the call was gone, the button must work again.
      setAnswering(false);
    }
  };
  // «Завершить тренировку»: no more calls; the place shows the start screen again.
  const [finishing, setFinishing] = useState(false);
  const finish = async () => {
    if (!window.confirm("Завершить тренировку? Новые вызовы приходить не будут, журнал и разборы останутся в кабинете.")) return;
    setFinishing(true);
    try {
      p.apply(await send<Op112State>("/api/op112/training/finish"));
    } catch (e) {
      p.notify(e instanceof ApiError && e.code === "card_open" ? "Сначала закончите открытую карточку" : "Не удалось завершить тренировку");
    } finally {
      setFinishing(false);
    }
  };

  const decline = async () => {
    if (!ringing) return;
    await send(`/api/op112/calls/${ringing.id}/decline`).catch(() => undefined);
    p.refresh();
  };

  // Insert picks up the ringing call (the «Принять» button also has the focus, so Enter works too).
  useEffect(() => {
    if (!ringing) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Insert") {
        e.preventDefault();
        void answer();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const lesson = p.state.lesson;
  return (
    <>
      <TopBar
        telephony={ringing ? { label: "Входящий вызов", tone: "ring" } : { label: "Доступен", tone: "ok" }}
        canHangup={false}
        onHangup={() => undefined}
        caller={null}
        onCaller={() => undefined}
        editable={false}
        incident={null}
        operatorNo={p.state.user.operatorNo}
        armNo={p.state.seat?.armNo ?? "1"}
        timer={null}
        onNotAvailable={(what) => p.notify(`${what}: в учебной версии не используется`)}
      />
      {ringing && (
        <div className="absolute left-1/2 top-[96px] z-40 flex w-[min(720px,92vw)] -translate-x-1/2 items-center gap-5 bg-arm-blue px-5 py-4 text-white shadow-2xl" role="alertdialog" aria-label="Входящий звонок">
          <IconPhone className="arm-ringing h-9 w-9 shrink-0" />
          <div className="min-w-0 flex-1 leading-tight">
            <div className="text-[18px] font-bold">Входящий звонок</div>
            <div className="text-[15px]">с номера {ringing.phone}</div>
          </div>
          <button
            type="button"
            autoFocus
            disabled={answering}
            onClick={answer}
            className="bg-white px-6 py-2.5 text-[16px] font-bold text-arm-blue hover:bg-[#eef6fb] disabled:opacity-70"
          >
            {answering ? "Соединяем…" : "Принять"}
          </button>
          <button type="button" onClick={decline} disabled={answering} title="Отклонить" className="px-1 text-[22px] leading-none text-white/80 hover:text-white disabled:opacity-40">
            ×
          </button>
        </div>
      )}
      <main className="flex min-h-0 flex-1 flex-col gap-2 p-2">
        <div className="flex items-center gap-4 bg-white px-4 py-3">
          <span className={`h-3 w-3 shrink-0 rounded-full ${ringing ? "bg-arm-blue" : noScenarios ? "bg-arm-late" : "animate-pulse bg-[#1c8a3a]"}`} />
          <div className="min-w-0 flex-1">
            <div className="text-[16px] font-semibold">
              {ringing ? "Входящий вызов — нажмите «Принять» (Insert)" : noScenarios ? "Нет одобренных сценариев для вызовов" : "Ожидание вызова…"}
            </div>
            <div className="text-[13px] text-arm-desc">
              {lesson?.title}
              {lesson?.selfTraining ? " · вызовы идут по одобренным учебным сценариям" : ""} · норматив набора карточки {mmss(lesson?.typingSec ?? 65)}
            </div>
          </div>
          {/* The way out, as at the ДДС place: end the practice, go to the cabinet, sign out. */}
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
            {lesson?.selfTraining && (
              <button type="button" className="arm-mini-btn !px-2.5 !py-1.5 !text-[12.5px]" disabled={finishing} onClick={finish}>
                {finishing ? "Завершаем…" : "Завершить тренировку"}
              </button>
            )}
            <Link href="/" className="arm-mini-btn !px-2.5 !py-1.5 !text-[12.5px]" title="Выйти с рабочего места в кабинет">
              В кабинет
            </Link>
            <form action="/logout" method="post">
              <button type="submit" className="arm-mini-btn !px-2.5 !py-1.5 !text-[12.5px]">
                Выйти
              </button>
            </form>
          </div>
        </div>
        <section className="flex min-h-0 flex-1 flex-col bg-white">
          <div className="flex items-center justify-between border-b border-[#dde1e3] px-4 py-2.5">
            <h2 className="text-[15px] font-bold">Журнал моих карточек</h2>
            <span className="text-[12.5px] text-arm-desc">Разбор — по кнопке в строке</span>
          </div>
          {p.state.journal.length ? (
            <div className="min-h-0 flex-1 overflow-y-auto">
              <table className="w-full text-left text-[13.5px]">
                <thead className="sticky top-0 bg-[#eef0f1] text-[12px] text-arm-desc">
                  <tr>
                    <th className="px-4 py-2 font-semibold">№</th>
                    <th className="px-2 py-2 font-semibold">Создана</th>
                    <th className="px-2 py-2 font-semibold">Что случилось</th>
                    <th className="px-2 py-2 font-semibold">Адрес</th>
                    <th className="px-2 py-2 font-semibold">Набор</th>
                    <th className="px-2 py-2 font-semibold">{lesson?.selfTraining ? "Самопроверка" : "Оценка"}</th>
                    <th className="px-4 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {p.state.journal.map((r) => (
                    <tr key={r.id} className="border-b border-[#eceef0]">
                      <td className="px-4 py-2 font-semibold">{r.number}</td>
                      <td className="px-2 py-2" title={dateTime(r.openedAt)}>
                        {hhmm(r.openedAt)}
                      </td>
                      <td className="px-2 py-2">{r.chips || "—"}</td>
                      <td className="max-w-[340px] truncate px-2 py-2" title={r.address}>
                        {r.address || "—"}
                      </td>
                      <td className={`px-2 py-2 tabular-nums ${r.typingSec !== null && r.typingSec > (lesson?.typingSec ?? 65) ? "font-semibold text-arm-late" : ""}`}>
                        {r.typingSec !== null ? mmss(r.typingSec) : "—"}
                      </td>
                      <td className="px-2 py-2">
                        {r.score !== null ? <MiniScore score={r.score} /> : lesson?.selfTraining ? "—" : <span className="text-arm-desc">после проверки</span>}
                      </td>
                      <td className="px-4 py-2 text-right">
                        <button type="button" className="arm-mini-btn" onClick={() => p.onReview(r.id, r.number)}>
                          разбор
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex flex-1 items-center justify-center p-6 text-center text-[14px] text-arm-desc">
              Карточек пока нет. Дождитесь вызова: примите его, расспросите заявителя в окне разговора справа и заполните карточку.
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function MiniScore({ score }: { score: number }) {
  const tone = score >= 80 ? "text-[#1c8a3a]" : score >= 60 ? "text-[#b87500]" : "text-arm-late";
  return <b className={tone}>{score}</b>;
}
