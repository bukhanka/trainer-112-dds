import { listScenarios } from "@/lib/scenarios/list";
import { teacherApi } from "@/lib/teacher/access";

export async function GET(request: Request) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const q = new URL(request.url).searchParams;
  return Response.json({ scenarios: await listScenarios({ status: q.get("status"), category: q.get("category"), q: q.get("q"), loc: q.get("loc") }) });
}
