import { loadBoardInput } from "@/lib/board/load";
import { buildBoard } from "@/lib/board/state";
import { findLesson, jsonError, teacherApi } from "@/lib/teacher/access";

/** Live state of the class. The board polls it every 2 s while the lesson runs. */
export async function GET(_request: Request, ctx: RouteContext<"/api/teacher/lessons/[id]/board">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const lesson = await findLesson(user, id);
  if (!lesson) return jsonError("Занятие не найдено", 404);

  const board = buildBoard(await loadBoardInput(lesson), new Date());
  return Response.json(
    { lesson: { id: lesson.id, title: lesson.title, status: lesson.status, startedAt: lesson.startedAt, finishedAt: lesson.finishedAt }, ...board },
    { headers: { "Cache-Control": "no-store" } },
  );
}
