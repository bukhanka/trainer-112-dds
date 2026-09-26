"use client";
/** Browser side of the 112 API and a shared clock. */
import { useSyncExternalStore } from "react";
import type { Op112State } from "@/lib/op112/state";

export type StateWithClock = Op112State & { clockOffset: number };

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    window.location.replace("/login");
    throw new ApiError(401, "unauthorized");
  }
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? "error");
  return data;
}

export async function getJson<T>(url: string): Promise<T> {
  return parse<T>(await fetch(url, { cache: "no-store" }));
}

export async function send<T>(url: string, body?: unknown, method = "POST"): Promise<T> {
  return parse<T>(
    await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

/** State plus the difference between the server clock and ours, so timers match the server. */
export function withClock(state: Op112State): StateWithClock {
  return { ...state, clockOffset: Date.parse(state.serverNow) - Date.now() };
}

export const fetchState = async (url: string) => withClock(await getJson<Op112State>(url));

// ─── Clock ───────────────────────────────────────────────────────────────────

let nowValue = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!timer) {
    nowValue = Date.now();
    timer = setInterval(() => {
      nowValue = Date.now();
      listeners.forEach((l) => l());
    }, 250);
  }
  return () => {
    listeners.delete(cb);
    if (!listeners.size && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

/** Current time in ms, updated four times a second; 0 during server rendering. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => nowValue,
    () => 0,
  );
}
