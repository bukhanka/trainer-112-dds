import { getGroupForecast } from "@/lib/adaptive/teacher";
import { teacherApi } from "@/lib/teacher/access";

/** Forecast of the next lesson for the students of the teacher's own groups, at-risk first. */
export async function GET() {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  return Response.json(await getGroupForecast(user), { headers: { "Cache-Control": "private, no-store" } });
}
