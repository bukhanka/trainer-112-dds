/** Russian formatting helpers shared by the cabinets. Moscow time: the training centre works in it. */

const TZ = "Europe/Moscow";

/** 75 → «1:15», 3725 → «1:02:05». */
export function formatDuration(totalSec: number | null | undefined): string {
  if (totalSec == null || !Number.isFinite(totalSec)) return "—";
  const sec = Math.max(0, Math.round(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = String(s).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Deviation from a norm: «+0:12» late, «−0:05» early. */
export function formatDelta(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec)) return "—";
  const r = Math.round(sec);
  if (r === 0) return "0:00";
  return `${r > 0 ? "+" : "−"}${formatDuration(Math.abs(r))}`;
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU", {
    timeZone: TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("ru-RU", { timeZone: TZ, day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatTime(value: Date | string | null | undefined, withSeconds = false): string {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("ru-RU", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    ...(withSeconds ? { second: "2-digit" } : {}),
  });
}

/** plural(3, ["попытка", "попытки", "попыток"]) → «попытки». */
export function plural(n: number, forms: [string, string, string]): string {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return forms[2];
  if (b > 1 && b < 5) return forms[1];
  if (b === 1) return forms[0];
  return forms[2];
}

export function countLabel(n: number, forms: [string, string, string]): string {
  return `${n} ${plural(n, forms)}`;
}

/** «Иванов Алексей Сергеевич» → «Иванов А. С.» */
export function shortName(fullName: string): string {
  const [last, ...rest] = fullName.trim().split(/\s+/);
  if (!rest.length) return last ?? "";
  return `${last} ${rest.map((p) => `${p[0]}.`).join(" ")}`;
}
