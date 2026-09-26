import { getStudentForecast } from "@/lib/adaptive/student";
import { apiUser } from "@/lib/auth/session";
import { viewerSession } from "@/lib/student/viewer";

/** The student's own forecast for the next lesson and level by role. Never anyone else's. */
export async function GET() {
  const user = await apiUser(["STUDENT"]);
  if (user instanceof Response) return user;
  return Response.json(await getStudentForecast(user.id, await viewerSession()), { headers: { "Cache-Control": "private, no-store" } });
}
