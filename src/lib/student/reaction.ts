/**
 * «Время реакции» of a student: how long the first action takes against the lesson's norm —
 * ДДС: «Добавлена» → the card opened (30 s, customer's answer of 27.09); 112: typing the card, «Принять» → «сохранить».
 * The same definition as in the lesson report (src/lib/adaptive/history.ts). Confirmed attempts only,
 * like everything else in the cabinet: a draft verdict never shows through.
 */
import { loadHistory, type HistoryAttempt } from "@/lib/adaptive/history";
import { isOtherSessionPractice, type ViewerSession } from "./results";

export type RoleReaction = {
  role: "OP112" | "DDS";
  attempts: number;
  avgSec: number;
  medianSec: number;
  /** The norm most of these attempts had (a lesson may set its own). */
  normSec: number;
  /** Attempts within their own lesson's norm. */
  onTime: number;
};

export type Reaction = { DDS: RoleReaction | null; OP112: RoleReaction | null };

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mostCommon(xs: number[]): number {
  const counts = new Map<number, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

export function buildReaction(history: HistoryAttempt[]): Reaction {
  const forRole = (role: "OP112" | "DDS"): RoleReaction | null => {
    const timed = history
      .filter((a) => a.kind === role && a.reviewStatus !== "PENDING")
      .flatMap((a) => (a.timeSec != null && a.timeSec >= 0 && a.normSec != null ? [{ sec: a.timeSec, norm: a.normSec }] : []));
    if (!timed.length) return null;
    const times = timed.map((a) => a.sec);
    return {
      role,
      attempts: timed.length,
      avgSec: Math.round(times.reduce((sum, t) => sum + t, 0) / times.length),
      medianSec: Math.round(median(times)),
      normSec: mostCommon(timed.map((a) => a.norm)),
      onTime: timed.filter((a) => a.sec <= a.norm).length,
    };
  };
  return { DDS: forRole("DDS"), OP112: forRole("OP112") };
}

export async function getReaction(studentId: string, viewer?: ViewerSession): Promise<Reaction> {
  const history = (await loadHistory([studentId])).get(studentId) ?? [];
  return buildReaction(history.filter((a) => !isOtherSessionPractice(a.lessonSettings, viewer)));
}
