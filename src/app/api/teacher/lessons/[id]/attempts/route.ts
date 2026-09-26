import { listLessonAttempts } from "@/lib/review/list";
import { findLesson, jsonError, teacherApi } from "@/lib/teacher/access";

/** Attempts of a lesson for the review list; filters: status, kind, seat. */
export async function GET(request: Request, ctx: RouteContext<"/api/teacher/lessons/[id]/attempts">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const lesson = await findLesson(user, id);
  if (!lesson) return jsonError("Занятие не найдено", 404);
  const q = new URL(request.url).searchParams;
  const attempts = await listLessonAttempts(id, { status: q.get("status"), kind: q.get("kind"), seat: q.get("seat") });
  return Response.json({ attempts });
}
