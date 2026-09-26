import { lessonForecast } from "@/lib/adaptive/teacher";
import { loadReportInput } from "@/lib/reports/load";
import { findLesson, jsonError, teacherApi } from "@/lib/teacher/access";

/** «Прогноз ↔ факт» of one lesson: the forecast saved at its start against the confirmed scores. */
export async function GET(_request: Request, ctx: RouteContext<"/api/teacher/lessons/[id]/forecast">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const lesson = await findLesson(user, id);
  if (!lesson) return jsonError("Занятие не найдено", 404);
  return Response.json(await lessonForecast(lesson.id, await loadReportInput(lesson)), { headers: { "Cache-Control": "private, no-store" } });
}
