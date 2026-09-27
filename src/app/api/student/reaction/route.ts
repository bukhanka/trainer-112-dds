import { apiUser } from "@/lib/auth/session";
import { getReaction } from "@/lib/student/reaction";
import { viewerSession } from "@/lib/student/viewer";

/** «Время реакции»: the student's own first-answer times against the norms, confirmed attempts only. */
export async function GET() {
  const user = await apiUser(["STUDENT"]);
  if (user instanceof Response) return user;
  return Response.json({ reaction: await getReaction(user.id, await viewerSession()) }, { headers: { "Cache-Control": "private, no-store" } });
}
