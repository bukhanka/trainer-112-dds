import { readJson, teacherApi } from "@/lib/teacher/access";
import { createFollowUps } from "@/lib/followup/service";

/** One confirmed error per student; the teacher starts the two ordinary lessons. */
export async function POST(request: Request) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const result = await createFollowUps(user, request, await readJson(request));
  return Response.json(result.ok ? result : { error: result.error }, { status: result.ok ? (result.existing ? 200 : 201) : result.status });
}
