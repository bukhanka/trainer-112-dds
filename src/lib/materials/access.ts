/**
 * Who sees which material — one rule for the lists, the downloads and the deletes, applied on the server to every
 * request (a foreign or missing material is «not found» alike):
 *
 *   all     every signed-in user: students, teachers, administrators;
 *   lesson  the students of that lesson — a place in it, or the lesson's group is theirs — its teacher and the
 *           uploader; a deleted lesson leaves the material to the uploader and the administrators only;
 *   staff   teachers and administrators: methodology and answer keys that students must not see.
 *
 * Administrators see everything. Students never see the «staff» materials nor lessons that are not theirs.
 */
import type { Prisma, Role } from "@prisma/client";
import { db } from "@/lib/db";

export type Viewer = { id: string; role: Role };

export const AUDIENCES = ["all", "lesson", "staff"] as const;
export type Audience = (typeof AUDIENCES)[number];

export const AUDIENCE_LABEL: Record<Audience, string> = {
  all: "всем обучающимся",
  lesson: "ученикам занятия",
  staff: "только преподавателям",
};

export function isAudience(value: unknown): value is Audience {
  return typeof value === "string" && (AUDIENCES as readonly string[]).includes(value);
}

/** Lessons whose materials a student sees: a place in the lesson, or a lesson of one of the student's groups. */
export async function studentLessonIds(studentId: string): Promise<string[]> {
  const [seats, memberships] = await Promise.all([
    db.seat.findMany({ where: { studentId }, select: { lessonId: true } }),
    db.groupMember.findMany({ where: { userId: studentId }, select: { groupId: true } }),
  ]);
  const groupIds = memberships.map((m) => m.groupId);
  const groupLessons = groupIds.length ? await db.lesson.findMany({ where: { groupId: { in: groupIds } }, select: { id: true } }) : [];
  return [...new Set([...seats.map((s) => s.lessonId), ...groupLessons.map((l) => l.id)])];
}

/** The materials a user may see, as a query condition. */
export async function materialScope(user: Viewer): Promise<Prisma.MaterialWhereInput> {
  if (user.role === "ADMIN") return {};
  if (user.role === "TEACHER") {
    const lessons = await db.lesson.findMany({ where: { teacherId: user.id }, select: { id: true } });
    return {
      OR: [{ audience: { in: ["all", "staff"] } }, { ownerId: user.id }, { audience: "lesson", lessonId: { in: lessons.map((l) => l.id) } }],
    };
  }
  const lessonIds = await studentLessonIds(user.id);
  return { OR: [{ audience: "all" }, { audience: "lesson", lessonId: { in: lessonIds } }] };
}

/** Why the user may not delete a material it sees, or null. Students never delete; teachers — only their own uploads. */
export function deleteRefusal(user: Viewer, material: { ownerId: string | null; source: string }): { error: string; status: number } | null {
  if (user.role === "STUDENT") return { error: "Недостаточно прав", status: 403 };
  if (process.env.DEMO_MODE === "true" && material.source === "demo") {
    return { error: "Материал демо-стенда удалить нельзя — загрузите свой файл и удалите его", status: 409 };
  }
  if (user.role !== "ADMIN" && material.ownerId !== user.id) return { error: "Удалить материал может тот, кто его загрузил, или администратор", status: 403 };
  return null;
}
