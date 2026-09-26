import { apiUser } from "@/lib/auth/session";
import { getStudentResults } from "@/lib/student/results";
import { viewerSession } from "@/lib/student/viewer";

/** The student's own attempts, progress and recommendations. Never anyone else's. */
export async function GET() {
  const user = await apiUser(["STUDENT"]);
  if (user instanceof Response) return user;
  return Response.json(await getStudentResults(user.id, await viewerSession()), { headers: { "Cache-Control": "private, no-store" } });
}
