/**
 * Usage counters per Moscow day: model calls and answers given by the rules instead of a model.
 *
 * Counting must cost nothing on the hot path, so every server process adds up in memory and writes the sums
 * at most once a minute with an atomic increment: several processes never overwrite each other. A process
 * that stops loses at most its last minute of counts.
 *
 *   ai.chat   — requests sent to the language model
 *   ai.voice  — requests sent to speech recognition or synthesis
 *   ai.rules  — the model was wanted, the rules answered: models switched off, not connected, over the limit
 *   ai.failed — the model was asked and failed (error, timeout, broken answer); the caller fell back
 */
import { db } from "../db";
import { moscowDay } from "./days";

export const USAGE_NAMES = ["ai.chat", "ai.voice", "ai.rules", "ai.failed"] as const;
export type UsageName = (typeof USAGE_NAMES)[number];

const FLUSH_EVERY_MS = 60_000;
const MAX_PENDING = 200; // a database outage must not grow the queue without bound

type State = { pending: Map<string, number>; lastFlush: number; timer: ReturnType<typeof setTimeout> | null };
// One state per process, shared by every server bundle that imports this module.
const holder = globalThis as unknown as { __usageCounters?: State };
const state = (): State => (holder.__usageCounters ??= { pending: new Map(), lastFlush: 0, timer: null });

export function countUsage(name: UsageName, n = 1, at: Date | number = Date.now()): void {
  const s = state();
  const key = `${moscowDay(at)}|${name}`;
  if (!s.pending.has(key) && s.pending.size >= MAX_PENDING) return;
  s.pending.set(key, (s.pending.get(key) ?? 0) + n);
  schedule(s);
}

function schedule(s: State) {
  if (s.timer) return;
  s.timer = setTimeout(() => void flushUsage(), Math.max(0, s.lastFlush + FLUSH_EVERY_MS - Date.now()));
  s.timer.unref?.();
}

/** Writes this process's sums now; called by the timer, at most once a minute. */
export async function flushUsage(): Promise<void> {
  const s = state();
  if (s.timer) clearTimeout(s.timer);
  s.timer = null;
  s.lastFlush = Date.now();
  const batch = [...s.pending];
  s.pending.clear();
  for (const [key, value] of batch) {
    const [day, name] = key.split("|");
    try {
      await db.$executeRaw`INSERT INTO "UsageCounter" ("day", "name", "value") VALUES (${day}, ${name}, ${value})
        ON CONFLICT ("day", "name") DO UPDATE SET "value" = "UsageCounter"."value" + EXCLUDED."value"`;
    } catch (err) {
      console.error("usage counters: write failed, kept for the next minute", err instanceof Error ? err.message : err);
      s.pending.set(key, (s.pending.get(key) ?? 0) + value);
    }
  }
  if (s.pending.size) schedule(s);
}

/** Counters of the given days: { "2026-09-27": { "ai.chat": 12, … } }. */
export async function readUsage(days: string[]): Promise<Record<string, Partial<Record<UsageName, number>>>> {
  if (!days.length) return {};
  const rows = await db.usageCounter.findMany({ where: { day: { in: days } } });
  const out: Record<string, Partial<Record<UsageName, number>>> = {};
  for (const r of rows) (out[r.day] ??= {})[r.name as UsageName] = r.value;
  return out;
}
