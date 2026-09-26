import { ddsContext } from "@/lib/dds/api";
import { seatResults } from "@/lib/dds/review";

/** Reviews of the place: the student sees their own, the teacher those of their lesson. */
export async function GET(request: Request) {
  const ctx = await ddsContext(request);
  if (ctx instanceof Response) return ctx;
  return Response.json({ serverNow: new Date().toISOString(), ...(await seatResults(ctx.access.seat.id)) });
}
