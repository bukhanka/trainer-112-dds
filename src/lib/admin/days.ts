/**
 * Calendar days for the administrator's statistics and journals, in Moscow time: the training centre
 * works in it. Moscow has no daylight saving time, so a Moscow day is a fixed UTC+3 window.
 */
const MSK_OFFSET_MS = 3 * 3_600_000;

/** «2026-09-27» — the Moscow day of this moment. */
export function moscowDay(at: Date | number = Date.now()): string {
  return new Date(new Date(at).getTime() + MSK_OFFSET_MS).toISOString().slice(0, 10);
}

/** The moment a Moscow day starts. */
export function moscowDayStart(day: string): Date {
  return new Date(`${day}T00:00:00+03:00`);
}

/** The last `count` Moscow days ending today, oldest first. */
export function lastDays(count: number, now: Date | number = Date.now()): string[] {
  const today = moscowDayStart(moscowDay(now)).getTime();
  return Array.from({ length: count }, (_, i) => moscowDay(today - (count - 1 - i) * 86_400_000));
}

/**
 * «2026-09-27» — the server's local day. The scheduler works in the server's local time (TZ=Europe/Moscow
 * in the Docker image, so it is the Moscow day there).
 */
export function localDay(at: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** The latest moment at or before `now` when the local clock showed «HH:MM». */
export function lastOccurrence(now: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  const at = new Date(now);
  at.setHours(h, m, 0, 0);
  if (at > now) at.setDate(at.getDate() - 1);
  return at;
}
