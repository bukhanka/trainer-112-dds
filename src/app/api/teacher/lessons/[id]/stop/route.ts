import { auditBy, findLesson, jsonError, teacherApi } from "@/lib/teacher/access";
import { db } from "@/lib/db";
import { finishLessonEvaluation } from "@/lib/dds/review";

/** Stop at any moment: cards stop flowing, attempts go to review. */
export async function POST(request: Request, ctx: RouteContext<"/api/teacher/lessons/[id]/stop">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const lesson = await findLesson(user, id);
  if (!lesson) return jsonError("Занятие не найдено", 404);
  if (lesson.status !== "RUNNING") return jsonError("Занятие не идёт", 409);

  const finishedAt = new Date();
  const res = await db.lesson.updateMany({ where: { id, status: "RUNNING" }, data: { status: "FINISHED", finishedAt } });
  if (!res.count) return jsonError("Занятие уже остановлено", 409);
  await auditBy(user, request, {
    action: "lesson.stop",
    entity: "Lesson",
    entityId: id,
    before: { status: "RUNNING", startedAt: lesson.startedAt?.toISOString() ?? null },
    after: { status: "FINISHED", finishedAt: finishedAt.toISOString() },
  });
  // ДДС places: calls are closed and every plate is reviewed now, even if a student has closed the page.
  try {
    await finishLessonEvaluation(id);
  } catch (err) {
    console.error("dds review at lesson stop failed", id, err);
  }
  return Response.json({ ok: true, finishedAt });
}
