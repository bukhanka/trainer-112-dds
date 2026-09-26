"use client";

import { useEffect, useRef } from "react";

/**
 * «Говорить»: hold the button or the space bar while speaking, release to send.
 * The parent owns the voice hook and decides what to do with the recognised text.
 */
export function PushToTalk({
  state,
  onStart,
  onStop,
  disabled,
  spaceKey = true,
}: {
  state: "idle" | "listening" | "thinking" | "speaking";
  onStart: () => void;
  onStop: () => void;
  disabled?: boolean;
  spaceKey?: boolean;
}) {
  const held = useRef(false);

  useEffect(() => {
    if (!spaceKey || disabled) return;
    const typing = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || typing(e.target) || held.current) return;
      e.preventDefault();
      held.current = true;
      onStart();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !held.current) return;
      e.preventDefault();
      held.current = false;
      onStop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [spaceKey, disabled, onStart, onStop]);

  const label =
    state === "listening" ? "Говорите… отпустите" : state === "thinking" ? "Распознаю…" : state === "speaking" ? "Собеседник говорит" : "Удерживайте, чтобы говорить";

  return (
    <button
      type="button"
      disabled={disabled || state === "thinking"}
      onPointerDown={(e) => {
        e.preventDefault();
        held.current = true;
        onStart();
      }}
      onPointerUp={() => {
        if (!held.current) return;
        held.current = false;
        onStop();
      }}
      onPointerLeave={() => {
        if (!held.current) return;
        held.current = false;
        onStop();
      }}
      className={`flex h-10 items-center gap-2 rounded px-3 text-sm font-semibold text-white disabled:opacity-50 ${
        state === "listening" ? "bg-arm-late" : "bg-arm-blue"
      }`}
      title={spaceKey ? "Или удерживайте пробел" : undefined}
    >
      <span aria-hidden>{state === "listening" ? "●" : "🎙"}</span>
      {label}
    </button>
  );
}
