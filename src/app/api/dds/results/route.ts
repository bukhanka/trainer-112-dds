import { ddsContext } from "@/lib/dds/api";
import { seatResults } from "@/lib/dds/review";
import { settingsOf } from "@/lib/dds/scope";

/**
 * Reviews of the place. A student sees the automatic review at once only in their own practice; after a
 * graded lesson the results come through the student cabinet once the teacher has checked them, as for
 * every other attempt. Teachers and admins always see them.
 */
export async function GET(request: Request) {
  const ctx = await ddsContext(request);
  if (ctx instanceof Response) return ctx;
  const { seat } = ctx.access;
  const open = ctx.user.role !== "STUDENT" || settingsOf(seat.lesson.settings).practice;
  if (!open) return Response.json({ serverNow: new Date().toISOString(), rows: [], average: null, hidden: true });
  return Response.json({ serverNow: new Date().toISOString(), ...(await seatResults(seat.id)) });
}
