import { getForecastHistory, getGroupForecast } from "@/lib/adaptive/teacher";
import { teacherApi } from "@/lib/teacher/access";

/** Forecast of the next lesson for the students of the teacher's own groups (at-risk first) and how past forecasts matched the fact. */
export async function GET() {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const [next, history] = await Promise.all([getGroupForecast(user), getForecastHistory(user)]);
  return Response.json({ ...next, history }, { headers: { "Cache-Control": "private, no-store" } });
}
