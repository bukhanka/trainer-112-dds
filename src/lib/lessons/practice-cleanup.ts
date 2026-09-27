/**
 * Practice without a lesson («Тренировка без занятия») that nobody works at any more is finished by itself, so it
 * does not hang as a running lesson in the administrator's counts: the login session a 112 practice belongs to is
 * over (logout, expiry), or nothing has happened in the practice for PRACTICE_IDLE_MIN minutes — no call, no card,
 * no status set by the student. A ДДС practice gets its review then, as with «Завершить тренировку».
 */
import { db } from "@/lib/db";
import { finishLessonEvaluation } from "@/lib/dds/review";
import { isPractice } from "./form";

export const PRACTICE_IDLE_MIN = 90;

export type PracticeLesson = { id: string; settings: unknown; startedAt: Date | null; createdAt: Date };

/** The login session a 112 practice was started in (Lesson.settings.sessionId); a ДДС practice has none. */
export function practiceSession(settings: unknown): string | null {
  const s = settings && typeof settings === "object" ? (settings as { sessionId?: unknown }).sessionId : undefined;
  return typeof s === "string" && s ? s : null;
}

/** Which of the running practices are abandoned: their session is gone, or they have been idle too long. */
export function abandonedPractice(
  lessons: PracticeLesson[],
  aliveSessions: Set<string>,
  lastActivity: Map<string, number>,
  now: number,
  idleMin = PRACTICE_IDLE_MIN,
): string[] {
  return lessons
    .filter((l) => isPractice(l.settings))
    .filter((l) => {
      const session = practiceSession(l.settings);
      if (session && !aliveSessions.has(session)) return true;
      const last = Math.max(lastActivity.get(l.id) ?? 0, (l.startedAt ?? l.createdAt).getTime());
      return now - last > idleMin * 60_000;
    })
    .map((l) => l.id);
}

const latest = (...dates: (Date | null | undefined)[]) => Math.max(0, ...dates.map((d) => d?.getTime() ?? 0));

/** Finish the abandoned practices; returns how many were closed. Safe to run from several processes. */
export async function closeAbandonedPractice(now = new Date()): Promise<number> {
  const running = await db.lesson.findMany({ where: { status: "RUNNING" }, select: { id: true, settings: true, startedAt: true, createdAt: true } });
  const practice = running.filter((l) => isPractice(l.settings));
  if (!practice.length) return 0;
  const ids = practice.map((l) => l.id);
  const sessionIds = practice.map((l) => practiceSession(l.settings)).filter((s): s is string => Boolean(s));
  const [alive, calls, cards, seats] = await Promise.all([
    db.session.findMany({ where: { id: { in: sessionIds }, expiresAt: { gt: now } }, select: { id: true } }),
    db.call.groupBy({ by: ["lessonId"], where: { lessonId: { in: ids } }, _max: { startedAt: true, answeredAt: true, endedAt: true } }),
    db.incident.groupBy({ by: ["lessonId"], where: { lessonId: { in: ids } }, _max: { createdAt: true, savedAt: true, workedAt: true } }),
    db.seat.findMany({ where: { lessonId: { in: ids } }, select: { id: true, lessonId: true } }),
  ]);
  const events = seats.length
    ? await db.statusEvent.groupBy({ by: ["seatId"], where: { seatId: { in: seats.map((s) => s.id) } }, _max: { at: true } })
    : [];
  const activity = new Map<string, number>();
  const bump = (lessonId: string | null, at: number) => {
    if (lessonId) activity.set(lessonId, Math.max(activity.get(lessonId) ?? 0, at));
  };
  for (const c of calls) bump(c.lessonId, latest(c._max.startedAt, c._max.answeredAt, c._max.endedAt));
  for (const c of cards) bump(c.lessonId, latest(c._max.createdAt, c._max.savedAt, c._max.workedAt));
  const lessonOfSeat = new Map(seats.map((s) => [s.id, s.lessonId]));
  for (const e of events) bump(e.seatId ? (lessonOfSeat.get(e.seatId) ?? null) : null, latest(e._max.at));

  const stale = abandonedPractice(practice, new Set(alive.map((s) => s.id)), activity, now.getTime());
  let closed = 0;
  for (const id of stale) {
    const done = await db.lesson.updateMany({ where: { id, status: "RUNNING" }, data: { status: "FINISHED", finishedAt: now } });
    if (!done.count) continue;
    closed++;
    await db.call.updateMany({ where: { lessonId: id, status: "RINGING" }, data: { status: "MISSED", endedAt: now } });
    // A ДДС practice is reviewed as if the student had pressed «Завершить тренировку».
    if (await db.seat.count({ where: { lessonId: id, role: "DDS" } })) await finishLessonEvaluation(id);
  }
  return closed;
}

/** «Выйти»: the 112 practice of this login session ends with it. */
export async function closeSessionPractice(sessionId: string, now = new Date()): Promise<number> {
  const running = await db.lesson.findMany({ where: { status: "RUNNING" }, select: { id: true, settings: true } });
  const mine = running.filter((l) => isPractice(l.settings) && practiceSession(l.settings) === sessionId).map((l) => l.id);
  if (!mine.length) return 0;
  const done = await db.lesson.updateMany({ where: { id: { in: mine }, status: "RUNNING" }, data: { status: "FINISHED", finishedAt: now } });
  await db.call.updateMany({ where: { lessonId: { in: mine }, status: "RINGING" }, data: { status: "MISSED", endedAt: now } });
  return done.count;
}
