import { db } from "@/lib/db";
import { auditBy, findLesson, jsonError, teacherApi } from "@/lib/teacher/access";

/** Start the lesson: from now on the workstations deliver cards and the plan is frozen. */
export async function POST(request: Request, ctx: RouteContext<"/api/teacher/lessons/[id]/start">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const lesson = await findLesson(user, id);
  if (!lesson) return jsonError("Занятие не найдено", 404);
  if (lesson.status === "RUNNING") return jsonError("Занятие уже идёт", 409);
  if (lesson.status === "FINISHED") return jsonError("Занятие уже завершено. Создайте копию, чтобы провести его ещё раз.", 409);

  const seats = await db.seat.findMany({ where: { lessonId: id }, select: { studentId: true, student: { select: { fullName: true } } } });
  if (!seats.length) return jsonError("В занятии нет ни одного места");

  // A student works at one place at a time: two running lessons would split the card flow.
  const busy = await db.seat.findMany({
    where: { studentId: { in: seats.map((s) => s.studentId) }, lesson: { status: "RUNNING", id: { not: id } } },
    select: { student: { select: { fullName: true } }, lesson: { select: { title: true } } },
  });
  if (busy.length) {
    const who = busy.map((b) => `${b.student.fullName} («${b.lesson.title}»)`).join(", ");
    return jsonError(`Эти ученики уже на другом идущем занятии: ${who}. Завершите его или уберите их из мест.`, 409);
  }

  const startedAt = new Date();
  const res = await db.lesson.updateMany({ where: { id, status: "DRAFT" }, data: { status: "RUNNING", startedAt } });
  if (!res.count) return jsonError("Занятие уже запущено", 409);
  await auditBy(user, request, {
    action: "lesson.start",
    entity: "Lesson",
    entityId: id,
    before: { status: lesson.status },
    after: { status: "RUNNING", startedAt: startedAt.toISOString(), seats: seats.length },
  });
  return Response.json({ ok: true, startedAt });
}
