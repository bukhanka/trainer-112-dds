/**
 * «Удержание» of a ДДС call: the counterpart waits on the line while the dispatcher takes another call
 * (a crew report that rings in, a call to another service), then comes back. The periods are kept on the
 * call as [{ from, to? }]; the last one stays open while the call is on hold. Pure helpers, no database.
 */
import type { Counterpart } from "./calls";

export type HoldPeriod = { from: string; to?: string };

export function readHolds(raw: unknown): HoldPeriod[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((h): h is HoldPeriod => !!h && typeof h === "object" && typeof (h as HoldPeriod).from === "string");
}

/** The hold going on now, if any. */
export function openHold(holds: HoldPeriod[]): HoldPeriod | null {
  const last = holds.at(-1);
  return last && !last.to ? last : null;
}

export function startHold(holds: HoldPeriod[], now: Date): HoldPeriod[] {
  return openHold(holds) ? holds : [...holds, { from: now.toISOString() }];
}

export function endHold(holds: HoldPeriod[], now: Date): HoldPeriod[] {
  const open = openHold(holds);
  return open ? [...holds.slice(0, -1), { from: open.from, to: now.toISOString() }] : holds;
}

/** Seconds the counterpart has waited on hold; an open period counts up to `untilMs` (now, or the end of the call). */
export function heldSeconds(holds: HoldPeriod[], untilMs: number): number {
  let ms = 0;
  for (const h of holds) {
    const from = Date.parse(h.from);
    const to = h.to ? Date.parse(h.to) : untilMs;
    if (Number.isFinite(from) && Number.isFinite(to) && to > from) ms += to - from;
  }
  return Math.round(ms / 1000);
}

/** What the counterpart says when the dispatcher comes back to the line. */
export function resumeLine(kind: Counterpart["kind"] | undefined): string {
  if (kind === "crew") return "На связи, слушаю.";
  if (kind === "caller") return "Да-да, я здесь, слушаю вас.";
  return "Да, на линии.";
}
