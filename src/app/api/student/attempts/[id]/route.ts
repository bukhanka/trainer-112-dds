import { apiUser } from "@/lib/auth/session";
import { getStudentAttempt } from "@/lib/student/results";
import { viewerSession } from "@/lib/student/viewer";

/** One own attempt: the breakdown only after the teacher confirmed it; someone else's attempt is 404. */
export async function GET(_request: Request, ctx: RouteContext<"/api/student/attempts/[id]">) {
  const user = await apiUser(["STUDENT"]);
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const attempt = await getStudentAttempt(user.id, id, await viewerSession());
  if (!attempt) return Response.json({ error: "Попытка не найдена" }, { status: 404 });
  return Response.json(attempt, { headers: { "Cache-Control": "private, no-store" } });
}
