import { ddsContext } from "@/lib/dds/api";
import { seatResults } from "@/lib/dds/review";
import { settingsOf } from "@/lib/dds/scope";

/**
 * Reviews of the place. A student sees their own only in practice or after the lesson — during a graded
 * lesson the verdicts would give away the reference answers. Teachers and admins always see them.
 */
export async function GET(request: Request) {
  const ctx = await ddsContext(request);
  if (ctx instanceof Response) return ctx;
  const { seat } = ctx.access;
  const open = ctx.user.role !== "STUDENT" || settingsOf(seat.lesson.settings).practice || seat.lesson.status === "FINISHED";
  if (!open) return Response.json({ serverNow: new Date().toISOString(), rows: [], average: null, hidden: true });
  return Response.json({ serverNow: new Date().toISOString(), ...(await seatResults(seat.id)) });
}
