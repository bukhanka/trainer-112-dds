import { auditBy, findLesson, jsonError, teacherApi } from "@/lib/teacher/access";
import { db } from "@/lib/db";
import { finishLessonEvaluation } from "@/lib/dds/review";
import { hangUp112Calls } from "@/lib/lessons/finish";

/** Stop at any moment: cards stop flowing, conversations end, attempts go to review. */
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
  // 112 places: the caller does not stay on the line after the lesson (the card stays open to be saved).
  const calls = await hangUp112Calls(id, finishedAt);
  await auditBy(user, request, {
    action: "lesson.stop",
    entity: "Lesson",
    entityId: id,
    before: { status: "RUNNING", startedAt: lesson.startedAt?.toISOString() ?? null },
    after: { status: "FINISHED", finishedAt: finishedAt.toISOString(), ...(calls.ended || calls.missed ? { callsEnded: calls.ended, callsMissed: calls.missed } : {}) },
  });
  // ДДС places: calls are closed and every plate is reviewed now, even if a student has closed the page.
  try {
    await finishLessonEvaluation(id);
  } catch (err) {
    console.error("dds review at lesson stop failed", id, err);
  }
  return Response.json({ ok: true, finishedAt });
}
