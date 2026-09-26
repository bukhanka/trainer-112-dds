/** Small formatting helpers of the 112 workstation. */

/** «+7 (916) 126-34-71» from whatever the operator types; partial input stays partial. */
export function formatPhone(input: string): string {
  let d = input.replace(/\D/g, "");
  if (!d) return "";
  if (d.length === 11 && (d[0] === "7" || d[0] === "8")) d = d.slice(1);
  else if (d[0] === "7" && d.length > 10) d = d.slice(1);
  d = d.slice(0, 10);
  const p = [d.slice(0, 3), d.slice(3, 6), d.slice(6, 8), d.slice(8, 10)];
  let out = `+7 (${p[0]}`;
  if (d.length >= 3) out += ")";
  if (p[1]) out += ` ${p[1]}`;
  if (p[2]) out += `-${p[2]}`;
  if (p[3]) out += `-${p[3]}`;
  return out;
}

/** Names are typed fast: every word starts with a capital letter, as the workstation does it. */
export function capitalizeWords(s: string): string {
  return s.replace(/(^|[\s-])([a-zа-яё])/g, (_m, p: string, c: string) => p + c.toUpperCase());
}

export function mmss(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export function hhmm(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

export function dateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.toLocaleDateString("ru-RU")} в ${d.toLocaleTimeString("ru-RU")}`;
}

export { channelOf } from "@/lib/op112/phone";
