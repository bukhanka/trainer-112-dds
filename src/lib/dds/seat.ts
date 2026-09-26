/**
 * Which ДДС place the current user works at. A student sees only their own place; a teacher or an
 * administrator may open a place of their lesson read-only (?seat=<id>) to watch it live.
 */
import type { Lesson, Prisma, Seat, Service } from "@prisma/client";
import type { SessionUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { lessonSettingsSchema } from "@/lib/lessons/settings";

export type DdsSeat = Seat & {
  lesson: Lesson;
  service: Service | null;
  student: { id: string; fullName: string; login: string };
};

const seatInclude = {
  lesson: true,
  service: true,
  student: { select: { id: true, fullName: true, login: true } },
} satisfies Prisma.SeatInclude;

/** The user's ДДС place in a running lesson (the latest one if there are several). */
export async function runningDdsSeat(userId: string): Promise<DdsSeat | null> {
  return db.seat.findFirst({
    where: { studentId: userId, role: "DDS", lesson: { status: "RUNNING" } },
    include: seatInclude,
    orderBy: { lesson: { startedAt: "desc" } },
  });
}

/** The user's latest ДДС place, running or finished — to show the results after the lesson. */
export async function latestDdsSeat(userId: string): Promise<DdsSeat | null> {
  return db.seat.findFirst({
    where: { studentId: userId, role: "DDS", lesson: { status: { in: ["RUNNING", "FINISHED"] } } },
    include: seatInclude,
    orderBy: { createdAt: "desc" },
  });
}

export type SeatAccess = { seat: DdsSeat; readOnly: boolean };

/**
 * Resolve the place for a request. Students: always their own running (or latest) place; the seat
 * parameter is honoured only if it is theirs. Teachers: places of their lessons, read-only. Admins: any, read-only.
 */
export async function seatForUser(user: SessionUser, seatId?: string | null): Promise<SeatAccess | null> {
  if (seatId) {
    const seat = await db.seat.findUnique({ where: { id: seatId }, include: seatInclude });
    if (!seat || seat.role !== "DDS") return null;
    if (seat.studentId === user.id) return { seat, readOnly: seat.lesson.status !== "RUNNING" };
    if (user.role === "ADMIN" || (user.role === "TEACHER" && seat.lesson.teacherId === user.id)) {
      return { seat, readOnly: true };
    }
    return null;
  }
  const running = await runningDdsSeat(user.id);
  if (running) return { seat: running, readOnly: false };
  const latest = await latestDdsSeat(user.id);
  return latest ? { seat: latest, readOnly: true } : null;
}

/** The territorial ДДС from the customer's screenshots; any service will do as a fallback. */
export async function practiceService(): Promise<Service | null> {
  return (
    (await db.service.findFirst({ where: { shortName: "Поселение Вороновское" } })) ??
    (await db.service.findFirst({ where: { kind: "территориальная", delivery: "ARM112" }, orderBy: { orderIdx: "asc" } })) ??
    (await db.service.findFirst({ where: { delivery: "ARM112" }, orderBy: { orderIdx: "asc" } }))
  );
}

export const PRACTICE_SETTINGS = lessonSettingsSchema.parse({
  practice: true,
  cardSource: "generated",
  tempoSec: 75,
  maxQueue: 2,
  ackSec: 30,
  workSec: 180,
  brigadeReports: true,
});

export type PracticeResult = { ok: true; seat: DdsSeat } | { ok: false; error: string };

/**
 * «Тренировка без занятия»: a personal running lesson with one ДДС place, so the workstation works
 * right after login, without a teacher.
 */
export async function startPractice(user: SessionUser): Promise<PracticeResult> {
  const existing = await runningDdsSeat(user.id);
  if (existing) return { ok: true, seat: existing };
  const service = await practiceService();
  if (!service) return { ok: false, error: "Справочник служб пуст: попросите администратора загрузить службы." };

  const now = new Date();
  const lesson = await db.lesson.create({
    data: {
      title: `Тренировка без занятия — ${user.fullName}`,
      teacherId: user.id,
      status: "RUNNING",
      startedAt: now,
      settings: PRACTICE_SETTINGS,
      seats: { create: { studentId: user.id, role: "DDS", serviceId: service.id, label: "Самостоятельно" } },
    },
    include: { seats: true },
  });
  await audit({
    action: "dds.practice.start",
    actorId: user.id,
    actor: user.login,
    entity: "Lesson",
    entityId: lesson.id,
    after: { serviceId: service.id },
  });
  const seat = await db.seat.findUniqueOrThrow({ where: { id: lesson.seats[0].id }, include: seatInclude });
  return { ok: true, seat };
}

export async function finishPractice(user: SessionUser, seat: DdsSeat): Promise<boolean> {
  const settings = lessonSettingsSchema.safeParse(seat.lesson.settings);
  if (seat.studentId !== user.id || !settings.success || !settings.data.practice || seat.lesson.status !== "RUNNING") {
    return false;
  }
  await db.lesson.update({ where: { id: seat.lessonId }, data: { status: "FINISHED", finishedAt: new Date() } });
  await audit({ action: "dds.practice.finish", actorId: user.id, actor: user.login, entity: "Lesson", entityId: seat.lessonId });
  return true;
}
