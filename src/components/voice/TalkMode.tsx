"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * How the trainee talks on the phone: «Голос» — the counterpart's lines are spoken aloud and the trainee answers
 * with «Говорить» (button or Space); «Текст» — the lines are only shown and the trainee types. Voice and text are
 * never mixed: a line is spoken only in «Голос». The mode follows what the trainee does — pressing «Говорить»
 * switches to «Голос», typing in the field switches to «Текст» — and the choice is remembered in this browser.
 * Until the trainee chooses, the mode is «Голос» when they can talk by voice at all, else «Текст».
 */
export type TalkMode = "voice" | "text";

const KEY = "trainer.talkMode"; // gitleaks:allow — a localStorage key name, not a secret
const listeners = new Set<() => void>();
/** The choice when the browser keeps no storage (a private window): it lives while the page is open. */
let memory: TalkMode | null = null;

function read(): TalkMode | null {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "voice" || v === "text") return v;
  } catch {
    /* storage is blocked: the choice of this page */
  }
  return memory;
}

function write(mode: TalkMode) {
  memory = mode;
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* the choice is simply not remembered */
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * The current talk mode, a setter and whether the mode is settled. `canListen` — the trainee can talk by voice (a
 * recogniser is available); undefined while the voice capabilities are still loading: the mode then shows «Голос»
 * but is not settled, and a line waits to be spoken until it is.
 */
export function useTalkMode(canListen: boolean | undefined): [TalkMode, (mode: TalkMode) => void, boolean] {
  const chosen = useSyncExternalStore(subscribe, read, () => null);
  const choose = useCallback((mode: TalkMode) => {
    if (read() !== mode) write(mode);
  }, []);
  const { mode, settled } = resolveTalkMode(chosen, canListen);
  return [mode, choose, settled];
}

/** The mode from the trainee's choice, else from the voice capabilities; not settled while both are unknown. */
export function resolveTalkMode(chosen: TalkMode | null, canListen: boolean | undefined): { mode: TalkMode; settled: boolean } {
  return { mode: chosen ?? (canListen === false ? "text" : "voice"), settled: chosen !== null || canListen !== undefined };
}

/** «Голос | Текст» in a dark phone header. */
export function TalkModeSwitch({ mode, onChange }: { mode: TalkMode; onChange: (mode: TalkMode) => void }) {
  return (
    <div role="group" aria-label="Режим разговора" className="flex shrink-0 overflow-hidden border border-white/35 text-[12px] leading-none">
      {(["voice", "text"] as const).map((m) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
          title={
            m === "voice"
              ? "Голос: собеседник говорит вслух, вы отвечаете кнопкой «Говорить» или пробелом"
              : "Текст: реплики собеседника только на экране, вы печатаете ответ"
          }
          className={`px-2 py-1.5 ${mode === m ? "bg-white font-semibold text-arm-dark" : "text-white/80 hover:bg-white/10"}`}
        >
          {m === "voice" ? "Голос" : "Текст"}
        </button>
      ))}
    </div>
  );
}
