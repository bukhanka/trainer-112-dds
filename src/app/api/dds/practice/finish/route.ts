import { ddsContext } from "@/lib/dds/api";
import { finishLessonEvaluation } from "@/lib/dds/review";
import { finishPractice } from "@/lib/dds/seat";

/** Ends the user's own practice lesson; the place stays readable with the results. */
export async function POST(request: Request) {
  const ctx = await ddsContext(request, { write: true });
  if (ctx instanceof Response) return ctx;
  const done = await finishPractice(ctx.user, ctx.access.seat);
  if (!done) return Response.json({ error: "not_practice", message: "Это не ваша самостоятельная тренировка" }, { status: 409 });
  const reviewed = await finishLessonEvaluation(ctx.access.seat.lessonId);
  return Response.json({ ok: true, lessonId: ctx.access.seat.lessonId, reviewed });
}
