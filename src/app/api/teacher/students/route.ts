import type { NextRequest } from "next/server";
import { jsonError, teacherApi } from "@/lib/teacher/access";
import { searchStudents } from "@/lib/teacher/groups";

/** Students for the «Добавить ученика» picker: name and login only, those without a group first. */
export async function GET(request: NextRequest) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const params = request.nextUrl.searchParams;
  const res = await searchStudents(user, { q: params.get("q"), groupId: params.get("groupId") });
  if (!res.ok) return jsonError(res.error, res.status);
  return Response.json({ students: res.data }, { headers: { "Cache-Control": "private, no-store" } });
}
