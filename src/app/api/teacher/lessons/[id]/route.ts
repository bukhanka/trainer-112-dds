import { db } from "@/lib/db";
import { lessonSnapshot, resolveLessonInput, seatRows } from "@/lib/lessons/save";
import { auditBy, findLesson, jsonError, readJson, teacherApi } from "@/lib/teacher/access";

const LOCKED = "Занятие уже запускалось: места, задания и настройки менять нельзя. Создайте копию занятия.";

export async function GET(_request: Request, ctx: RouteContext<"/api/teacher/lessons/[id]">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const lesson = await findLesson(user, id);
  if (!lesson) return jsonError("Занятие не найдено", 404);
  const seats = await db.seat.findMany({
    where: { lessonId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, studentId: true, role: true, serviceId: true, scenarioIds: true, label: true },
  });
  return Response.json({ lesson, seats });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/teacher/lessons/[id]">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const lesson = await findLesson(user, id);
  if (!lesson) return jsonError("Занятие не найдено", 404);
  if (lesson.status !== "DRAFT") return jsonError(LOCKED, 409);

  const resolved = await resolveLessonInput(user, await readJson(request));
  if (!resolved.ok) return jsonError(resolved.error);
  const { title, groupId, settings, seats } = resolved.data;

  const beforeSeats = await db.seat.findMany({ where: { lessonId: id }, orderBy: { createdAt: "asc" } });
  const updated = await db.$transaction(async (tx) => {
    // Re-check inside the transaction: the lesson may have been started a moment ago.
    const res = await tx.lesson.updateMany({ where: { id, status: "DRAFT" }, data: { title, groupId, settings } });
    if (!res.count) return null;
    await tx.seat.deleteMany({ where: { lessonId: id } });
    await tx.seat.createMany({ data: seatRows(id, seats) });
    return tx.lesson.findUniqueOrThrow({ where: { id } });
  });
  if (!updated) return jsonError(LOCKED, 409);

  await auditBy(user, request, {
    action: "lesson.update",
    entity: "Lesson",
    entityId: id,
    before: lessonSnapshot(lesson, beforeSeats),
    after: lessonSnapshot(updated, seats),
  });
  return Response.json({ id });
}

export async function DELETE(request: Request, ctx: RouteContext<"/api/teacher/lessons/[id]">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const lesson = await findLesson(user, id);
  if (!lesson) return jsonError("Занятие не найдено", 404);
  if (lesson.status !== "DRAFT") return jsonError("Удалить можно только черновик: у проведённого занятия есть результаты учеников.", 409);

  const seats = await db.seat.findMany({ where: { lessonId: id } });
  const res = await db.lesson.deleteMany({ where: { id, status: "DRAFT" } });
  if (!res.count) return jsonError("Занятие уже запущено", 409);
  await auditBy(user, request, {
    action: "lesson.delete",
    entity: "Lesson",
    entityId: id,
    before: lessonSnapshot(lesson, seats),
  });
  return Response.json({ ok: true });
}
