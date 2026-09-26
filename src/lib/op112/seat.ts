/** The student's 112 place: the running lesson and seat, personal training, the next call. */
import type { Prisma, Scenario } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { studentRating } from "@/lib/adaptive/levels";
import { pickAdaptive } from "@/lib/adaptive/pick";
import { isPractice } from "@/lib/lessons/form";
import { adaptiveChoice, lessonSettingsSchema, parseLessonSettings, type LessonSettings } from "@/lib/lessons/settings";

export type Op112Seat = Prisma.SeatGetPayload<{ include: { lesson: true } }>;

/** Marker in Lesson.settings for a lesson a student started alone («Тренировка без занятия»). */
export const SELF_TRAINING_KEY = "selfTraining";
/** The login session such a lesson belongs to (Lesson.settings.sessionId). */
export const SELF_SESSION_KEY = "sessionId";

function settingsOf(settings: unknown): Record<string, unknown> {
  return settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
}

/** Practice lessons: our marker or the teacher cabinet's «practice» (it hides them from class lists). */
export function isSelfTraining(settings: unknown): boolean {
  return Boolean(settingsOf(settings)[SELF_TRAINING_KEY]) || isPractice(settings);
}

/** A lesson seat is visible to every session of its student; a practice seat — only to the session that started it. */
export function seatVisibleTo(seat: { lesson: { settings: unknown } }, sessionId: string | null): boolean {
  if (!isSelfTraining(seat.lesson.settings)) return true;
  return Boolean(sessionId) && settingsOf(seat.lesson.settings)[SELF_SESSION_KEY] === sessionId;
}

/** A seat of a running lesson; a teacher's lesson wins over practice. */
export async function findActiveSeat(userId: string, sessionId: string | null): Promise<Op112Seat | null> {
  const seats = (
    await db.seat.findMany({
      where: { studentId: userId, role: "OP112", lesson: { status: "RUNNING" } },
      include: { lesson: true },
      orderBy: { createdAt: "desc" },
    })
  ).filter((s) => seatVisibleTo(s, sessionId));
  return seats.find((s) => !isSelfTraining(s.lesson.settings)) ?? seats[0] ?? null;
}

/**
 * A place whose lesson the teacher has already stopped but where a card is still open: the operator
 * finishes it (save, «отработана», review) instead of losing it.
 */
export async function findSeatWithOpenCard(userId: string, sessionId: string | null): Promise<Op112Seat | null> {
  const seats = (
    await db.seat.findMany({
      where: { studentId: userId, role: "OP112", lesson: { status: "FINISHED" } },
      include: { lesson: true },
      orderBy: { createdAt: "desc" },
      take: 10,
    })
  ).filter((s) => seatVisibleTo(s, sessionId));
  for (const seat of seats) {
    const open = await db.incident.count({ where: { createdBySeatId: seat.id, status: { in: ["draft", "registered"] } } });
    if (open) return seat;
  }
  return null;
}

/** Whether the user sits at a ДДС place of a running lesson (the 112 screen then points there). */
export async function hasDdsSeat(userId: string): Promise<boolean> {
  const n = await db.seat.count({ where: { studentId: userId, role: "DDS", lesson: { status: "RUNNING" } } });
  return n > 0;
}

export function lessonSettings(seat: Op112Seat): LessonSettings {
  try {
    return parseLessonSettings(seat.lesson.settings);
  } catch {
    return lessonSettingsSchema.parse({});
  }
}

/**
 * Start (or reuse) practice: a personal lesson with one 112 seat for this login session, so a student
 * can train without a teacher and two people signed in with one account do not share it.
 */
export async function startSelfTraining(user: SessionUser, sessionId: string): Promise<Op112Seat> {
  const mine = await db.seat.findMany({
    where: { studentId: user.id, role: "OP112", lesson: { status: "RUNNING" } },
    include: { lesson: true },
    orderBy: { createdAt: "desc" },
  });
  const existing = mine.find((s) => isSelfTraining(s.lesson.settings) && seatVisibleTo(s, sessionId));
  if (existing) return existing;

  // Practice of sessions that are over (logout, expiry) is closed, so it does not hang as a running lesson.
  const stale = mine.filter((s) => isSelfTraining(s.lesson.settings));
  if (stale.length) {
    const alive = new Set(
      (
        await db.session.findMany({
          where: { id: { in: stale.map((s) => String(settingsOf(s.lesson.settings)[SELF_SESSION_KEY] ?? "")) }, expiresAt: { gt: new Date() } },
          select: { id: true },
        })
      ).map((x) => x.id),
    );
    const finished = stale.filter((s) => !alive.has(String(settingsOf(s.lesson.settings)[SELF_SESSION_KEY] ?? ""))).map((s) => s.lessonId);
    if (finished.length) await db.lesson.updateMany({ where: { id: { in: finished } }, data: { status: "FINISHED", finishedAt: new Date() } });
  }

  // The lesson belongs to the student's group teacher, so the teacher sees these attempts too.
  const membership = await db.groupMember.findFirst({ where: { userId: user.id }, include: { group: true } });
  const teacherId =
    membership?.group.teacherId ??
    (await db.user.findFirst({ where: { role: "TEACHER", isBlocked: false }, orderBy: { createdAt: "asc" } }))?.id ??
    user.id;

  const settings = { ...lessonSettingsSchema.parse({ hints: true }), practice: true, [SELF_TRAINING_KEY]: true, [SELF_SESSION_KEY]: sessionId };
  const lesson = await db.lesson.create({
    data: {
      title: `Самостоятельная тренировка — ${user.fullName}`,
      teacherId,
      groupId: membership?.groupId ?? null,
      status: "RUNNING",
      startedAt: new Date(),
      settings,
    },
  });
  return db.seat.create({
    data: { lessonId: lesson.id, studentId: user.id, role: "OP112", label: "Место 1" },
    include: { lesson: true },
  });
}

const USABLE: Prisma.ScenarioWhereInput = {
  OR: [{ status: "APPROVED" }, { approvedSections: { has: "caller" } }],
  NOT: { status: "ARCHIVED" },
};

/**
 * Next scenario for a seat: the teacher's list for this place if any, otherwise approved scenarios
 * of the lesson's categories. Scenarios the seat has not had yet come first: near the student's level
 * when the lesson is adaptive (src/lib/adaptive), easier first when it is not.
 */
export async function nextScenario(seat: Op112Seat): Promise<Scenario | null> {
  const settings = lessonSettings(seat);
  const where: Prisma.ScenarioWhereInput = seat.scenarioIds.length
    ? { id: { in: seat.scenarioIds } }
    : settings.categories.length
      ? { AND: [USABLE, { category: { in: settings.categories } }] }
      : USABLE;
  const pool = await db.scenario.findMany({ where, orderBy: [{ difficulty: "asc" }, { createdAt: "asc" }] });
  if (!pool.length) return null;
  const used = await db.incident.groupBy({
    by: ["scenarioId"],
    where: { createdBySeatId: seat.id, scenarioId: { not: null } },
    _max: { createdAt: true },
  });
  const lastUse = new Map(used.flatMap((u) => (u.scenarioId ? [[u.scenarioId, u._max.createdAt?.getTime() ?? 0] as const] : [])));
  if (!seat.scenarioIds.length && adaptiveChoice(seat.lesson.settings)) {
    const level = await studentRating(seat.studentId, "OP112");
    return pickAdaptive(pool, { target: level.difficulty, lastUsed: lastUse });
  }
  const fresh = pool.filter((s) => !lastUse.has(s.id));
  if (fresh.length) return fresh[0];
  return [...pool].sort((a, b) => (lastUse.get(a.id) ?? 0) - (lastUse.get(b.id) ?? 0))[0];
}

/** «Опер. 1003»: a stable operator number per account, like the numbers on the customer's cards. */
export function operatorNumber(login: string): string {
  const digits = login.replace(/\D/g, "");
  if (digits) return String(1000 + (Number(digits) % 9000));
  let h = 0;
  for (const ch of login) h = (h * 31 + ch.charCodeAt(0)) % 9000;
  return String(1000 + h);
}
