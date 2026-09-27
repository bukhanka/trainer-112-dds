import { apiUser } from "@/lib/auth/session";
import { getAssignments } from "@/lib/student/assignments";

/** «Мои задания»: the student's own places in running and draft lessons with their tasks. */
export async function GET() {
  const user = await apiUser(["STUDENT"]);
  if (user instanceof Response) return user;
  return Response.json({ assignments: await getAssignments(user.id) }, { headers: { "Cache-Control": "private, no-store" } });
}
