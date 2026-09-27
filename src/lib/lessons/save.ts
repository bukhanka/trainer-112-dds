import type { Prisma } from "@prisma/client";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { groupScope } from "@/lib/teacher/access";
import { GROUP_ARCHIVED } from "@/lib/teacher/groups";
import { firstIssue, lessonInputSchema, normalizeSeats, type NormalizedSeat, type TeacherSettings } from "./form";

export type ResolvedLesson = {
  title: string;
  groupId: string;
  settings: TeacherSettings;
  seats: NormalizedSeat[];
};

/** Validates the lesson form against the database: own group, its members, real services, approved tasks. */
export async function resolveLessonInput(
  user: SessionUser,
  raw: unknown,
): Promise<{ ok: true; data: ResolvedLesson } | { ok: false; error: string }> {
  const parsed = lessonInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;

  const group = await db.group.findFirst({
    where: { id: input.groupId, ...groupScope(user) },
    include: { members: { select: { userId: true } } },
  });
  if (!group) return { ok: false, error: "Группа не найдена" };
  if (group.archivedAt) return { ok: false, error: GROUP_ARCHIVED };

  const { seats, error } = normalizeSeats(input);
  if (error) return { ok: false, error };
  if (!seats.length) return { ok: false, error: "Добавьте хотя бы одно место" };

  const members = new Set(group.members.map((m) => m.userId));
  if (seats.some((s) => !members.has(s.studentId))) return { ok: false, error: "На месте указан ученик не из этой группы" };

  const serviceIds = [...new Set(seats.flatMap((s) => (s.serviceId ? [s.serviceId] : [])))];
  if (serviceIds.length) {
    const found = await db.service.count({ where: { id: { in: serviceIds } } });
    if (found !== serviceIds.length) return { ok: false, error: "Служба ДДС не найдена в справочнике" };
  }

  const scenarioIds = [...new Set(seats.flatMap((s) => s.scenarioIds))];
  if (scenarioIds.length) {
    const scenarios = await db.scenario.findMany({ where: { id: { in: scenarioIds } }, select: { id: true, title: true, status: true } });
    if (scenarios.length !== scenarioIds.length) return { ok: false, error: "Задание не найдено — обновите страницу" };
    const draft = scenarios.find((s) => s.status !== "APPROVED");
    if (draft) return { ok: false, error: `Сценарий «${draft.title}» не утверждён: утвердите его в разделе «Сценарии»` };
  }

  return { ok: true, data: { title: input.title, groupId: group.id, settings: input.settings, seats } };
}

export function seatRows(lessonId: string, seats: NormalizedSeat[]): Prisma.SeatCreateManyInput[] {
  return seats.map((s) => ({ lessonId, ...s }));
}

/** Compact form for the audit journal. */
export function lessonSnapshot(lesson: { title: string; groupId: string | null; settings: unknown; status?: string }, seats: NormalizedSeat[] | { studentId: string; role: string; serviceId: number | null; scenarioIds: string[]; label: string | null }[]) {
  return {
    title: lesson.title,
    groupId: lesson.groupId,
    status: lesson.status ?? null,
    settings: lesson.settings as Prisma.InputJsonValue,
    seats: seats.map((s) => ({ student: s.studentId, role: s.role, service: s.serviceId, tasks: s.scenarioIds, label: s.label })),
  };
}
