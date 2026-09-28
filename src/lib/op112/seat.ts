/** The student's 112 place: the running lesson and seat, personal training, the next call. */
import type { Prisma, Scenario } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { studentRating } from "@/lib/adaptive/levels";
import { pickAdaptive } from "@/lib/adaptive/pick";
import { isPractice } from "@/lib/lessons/form";
import { adaptiveChoice, lessonSettingsSchema, parseLessonSettings, type LessonSettings } from "@/lib/lessons/settings";
import { inPlayAtDds, notRightAfter, preferNotInPlay } from "@/lib/lessons/in-play";
import { hasCardError } from "@/lib/dds/scenario";
import { withoutPairsOf, withPairs } from "@/lib/scenarios/pairs";
import { inLessonLocation } from "@/lib/scenarios/place";

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

/**
 * «Завершить тренировку»: the student's own practice ends — only between calls (a card still open is finished
 * first), a call still ringing is marked missed.
 */
export async function finishSelfTraining(user: SessionUser, seat: Op112Seat): Promise<{ ok: true } | { ok: false; error: string }> {
  if (seat.studentId !== user.id || !isSelfTraining(seat.lesson.settings)) return { ok: false, error: "not_practice" };
  const open = await db.incident.count({ where: { createdBySeatId: seat.id, status: { in: ["draft", "registered"] } } });
  if (open) return { ok: false, error: "card_open" };
  const now = new Date();
  const done = await db.lesson.updateMany({ where: { id: seat.lessonId, status: "RUNNING" }, data: { status: "FINISHED", finishedAt: now } });
  if (!done.count) return { ok: false, error: "not_practice" };
  await db.call.updateMany({ where: { seatId: seat.id, status: "RINGING" }, data: { status: "MISSED", endedAt: now } });
  return { ok: true };
}

const USABLE: Prisma.ScenarioWhereInput = {
  OR: [{ status: "APPROVED" }, { approvedSections: { has: "caller" } }],
  NOT: { status: "ARCHIVED" },
};

/**
 * Next scenario for a seat: the teacher's list for this place if any, otherwise approved scenarios
 * of the lesson's categories and location. Scenarios the seat has not had yet come first: near the student's level
 * when the lesson is adaptive (src/lib/adaptive), easier first when it is not.
 */
export async function nextScenario(seat: Op112Seat): Promise<Scenario | null> {
  const settings = lessonSettings(seat);
  const where: Prisma.ScenarioWhereInput = seat.scenarioIds.length
    ? { id: { in: seat.scenarioIds } }
    : settings.categories.length
      ? { AND: [USABLE, { category: { in: settings.categories } }] }
      : USABLE;
  const listed = await db.scenario.findMany({ where, orderBy: [{ difficulty: "asc" }, { createdAt: "asc" }] });
  // A variant with an error in the card is played at the ДДС place only: for the operator it is the same call as its
  // ticket (dds/scenario.ts). Not even when the teacher marked it for the place.
  const found = await withoutEarlyRepeats(inLessonLocation(listed.filter((s) => !hasCardError(s.ddsReference)), seat, settings), seat.lessonId);
  if (!found.length) return null;
  const used = await db.incident.groupBy({
    by: ["scenarioId"],
    where: { createdBySeatId: seat.id, scenarioId: { not: null } },
    _max: { createdAt: true },
  });
  const lastUse = new Map(used.flatMap((u) => (u.scenarioId ? [[u.scenarioId, u._max.createdAt?.getTime() ?? 0] as const] : [])));
  // A place drawing by itself never rings with the other half of a pair it has had (scenarios/pairs.ts); it does not ring
  // with a situation open in a ДДС feed of the lesson, a ticket whose variant with an error in the card is open there
  // included (lessons/in-play.ts), and never with the same situation twice in a row while there is another.
  const had =
    seat.scenarioIds.length || !lastUse.size
      ? []
      : await db.scenario.findMany({ where: { id: { in: [...lastUse.keys()] } }, select: { id: true, ticketRef: true } });
  const drawn = seat.scenarioIds.length ? found : withoutPairsOf(found, had);
  const free = seat.scenarioIds.length ? drawn : preferNotInPlay(drawn, withPairs(await inPlayAtDds(db, seat.lessonId), listed));
  const last = [...lastUse.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const pool = notRightAfter([free, drawn], last);
  if (!seat.scenarioIds.length && adaptiveChoice(seat.lesson.settings)) {
    const level = await studentRating(seat.studentId, "OP112");
    return pickAdaptive(pool, { target: level.difficulty, lastUsed: lastUse });
  }
  const fresh = pool.filter((s) => !lastUse.has(s.id));
  if (fresh.length) return fresh[0];
  return [...pool].sort((a, b) => (lastUse.get(a.id) ?? 0) - (lastUse.get(b.id) ?? 0))[0];
}

/** The ticket a scenario repeats («Совпадение»: a second call about an incident already on a card). */
export function repeatOf(truth: unknown): string | undefined {
  const r = truth && typeof truth === "object" ? (truth as { repeatOf?: unknown }).repeatOf : undefined;
  return typeof r === "string" && r ? r : undefined;
}

/**
 * A repeat call rings only once a 112 place of the lesson has saved a card of the incident it repeats: otherwise
 * there is nothing to link it to (a card the system dealt to a ДДС place does not count).
 */
export async function withoutEarlyRepeats<T extends { truth: unknown }>(pool: T[], lessonId: string): Promise<T[]> {
  const refs = [...new Set(pool.map((s) => repeatOf(s.truth)).filter((r): r is string => Boolean(r)))];
  if (!refs.length) return pool;
  const cards = await db.incident.findMany({
    where: { lessonId, source: "op112", status: { in: ["registered", "worked"] }, scenario: { ticketRef: { in: refs } } },
    select: { scenario: { select: { ticketRef: true } } },
  });
  const played = new Set(cards.map((c) => c.scenario?.ticketRef));
  return pool.filter((s) => {
    const r = repeatOf(s.truth);
    return !r || played.has(r);
  });
}

/** «Опер. 1003»: a stable operator number per account, like the numbers on the customer's cards. */
export function operatorNumber(login: string): string {
  const digits = login.replace(/\D/g, "");
  if (digits) return String(1000 + (Number(digits) % 9000));
  let h = 0;
  for (const ch of login) h = (h * 31 + ch.charCodeAt(0)) % 9000;
  return String(1000 + h);
}
