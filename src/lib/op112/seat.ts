/** The student's 112 place: the running lesson and seat, personal training, the next call. */
import type { Prisma, Scenario } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { lessonSettingsSchema, parseLessonSettings, type LessonSettings } from "@/lib/lessons/settings";

export type Op112Seat = Prisma.SeatGetPayload<{ include: { lesson: true } }>;

/** Marker in Lesson.settings for a lesson a student started alone («Тренировка без занятия»). */
export const SELF_TRAINING_KEY = "selfTraining";

export function isSelfTraining(settings: unknown): boolean {
  return Boolean(settings && typeof settings === "object" && (settings as Record<string, unknown>)[SELF_TRAINING_KEY]);
}

/** A seat of a running lesson; a teacher's lesson wins over personal training. */
export async function findActiveSeat(userId: string): Promise<Op112Seat | null> {
  const seats = await db.seat.findMany({
    where: { studentId: userId, role: "OP112", lesson: { status: "RUNNING" } },
    include: { lesson: true },
    orderBy: { createdAt: "desc" },
  });
  return seats.find((s) => !isSelfTraining(s.lesson.settings)) ?? seats[0] ?? null;
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

/** Start (or reuse) a personal lesson with one 112 seat, so a student can train without a teacher. */
export async function startSelfTraining(user: SessionUser): Promise<Op112Seat> {
  const existing = await db.seat.findFirst({
    where: { studentId: user.id, role: "OP112", lesson: { status: "RUNNING" } },
    include: { lesson: true },
    orderBy: { createdAt: "desc" },
  });
  if (existing && isSelfTraining(existing.lesson.settings)) return existing;

  // The lesson belongs to the student's group teacher, so the teacher sees these attempts too.
  const membership = await db.groupMember.findFirst({ where: { userId: user.id }, include: { group: true } });
  const teacherId =
    membership?.group.teacherId ??
    (await db.user.findFirst({ where: { role: "TEACHER", isBlocked: false }, orderBy: { createdAt: "asc" } }))?.id ??
    user.id;

  const settings = { ...lessonSettingsSchema.parse({ hints: true }), [SELF_TRAINING_KEY]: true };
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
 * of the lesson's categories. Scenarios the seat has not had yet come first, easier first.
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
  const lastUse = new Map(used.map((u) => [u.scenarioId, u._max.createdAt?.getTime() ?? 0]));
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
