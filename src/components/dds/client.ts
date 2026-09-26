"use client";

import { useSyncExternalStore } from "react";

/** JSON fetch that remembers the difference between the server clock and this browser. */
export async function getJson<T>(url: string): Promise<T & { clientOffset: number }> {
  const res = await fetch(url, { cache: "no-store" });
  if (res.status === 401) throw new Error("Сессия истекла — войдите снова");
  const data = (await res.json()) as T & { serverNow?: string; message?: string };
  if (!res.ok) throw new Error(data.message ?? `HTTP ${res.status}`);
  const clientOffset = data.serverNow ? Date.parse(data.serverNow) - Date.now() : 0;
  return { ...data, clientOffset };
}

export type PostResult<T> = { ok: true; data: T } | { ok: false; message: string; status: number };

export async function postJson<T>(url: string, body?: unknown): Promise<PostResult<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { message?: string };
    if (!res.ok) return { ok: false, message: data.message ?? `Ошибка ${res.status}`, status: res.status };
    return { ok: true, data };
  } catch {
    return { ok: false, message: "Нет связи с сервером", status: 0 };
  }
}

/** Adds ?seat= for a teacher watching a place; students never need it. */
export function withSeat(url: string, seat: string | null): string {
  if (!seat) return url;
  return `${url}${url.includes("?") ? "&" : "?"}seat=${encodeURIComponent(seat)}`;
}

// ─── A shared clock: one timer for every counter on the screen ──────────────

let now = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      listeners.forEach((l) => l());
    }, 250);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Current time in ms, corrected to the server clock; 0 during server rendering. */
export function useNow(offset = 0): number {
  const t = useSyncExternalStore(
    subscribe,
    () => now,
    () => 0,
  );
  return t ? t + offset : 0;
}

// ─── Signals ────────────────────────────────────────────────────────────────

let audio: AudioContext | null = null;

/** Short beeps through Web Audio; silently does nothing until the page got a click. */
export function beep(freq = 880, times = 2, ms = 160) {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
    for (let i = 0; i < times; i++) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.value = 0.07;
      osc.connect(gain).connect(audio.destination);
      const start = audio.currentTime + (i * ms * 1.7) / 1000;
      osc.start(start);
      osc.stop(start + ms / 1000);
    }
  } catch {
    // no audio in this browser — the screen still blinks
  }
}
