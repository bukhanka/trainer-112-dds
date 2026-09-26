import { db } from "@/lib/db";
import { auditBy, findLesson, jsonError, teacherApi } from "@/lib/teacher/access";

/** «Провести ещё раз»: a new draft with the same settings, places and tasks. */
export async function POST(request: Request, ctx: RouteContext<"/api/teacher/lessons/[id]/copy">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const lesson = await findLesson(user, id);
  if (!lesson) return jsonError("Занятие не найдено", 404);

  const seats = await db.seat.findMany({ where: { lessonId: id }, orderBy: { createdAt: "asc" } });
  const approved = new Set(
    (await db.scenario.findMany({ where: { id: { in: seats.flatMap((s) => s.scenarioIds) }, status: "APPROVED" }, select: { id: true } })).map((s) => s.id),
  );
  const title = `${lesson.title} (копия)`.slice(0, 120);
  const copy = await db.$transaction(async (tx) => {
    const created = await tx.lesson.create({
      data: { title, groupId: lesson.groupId, settings: lesson.settings ?? {}, teacherId: user.id },
    });
    await tx.seat.createMany({
      data: seats.map((s) => ({
        lessonId: created.id,
        studentId: s.studentId,
        role: s.role,
        serviceId: s.serviceId,
        label: s.label,
        scenarioIds: s.scenarioIds.filter((x) => approved.has(x)),
      })),
    });
    return created;
  });
  await auditBy(user, request, { action: "lesson.copy", entity: "Lesson", entityId: copy.id, after: { from: id, title } });
  return Response.json({ id: copy.id }, { status: 201 });
}
