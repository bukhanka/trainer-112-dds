import { auditBy, jsonError, readJson, teacherApi } from "@/lib/teacher/access";
import { addMember } from "@/lib/teacher/groups";

/** Add a student (an existing account with the STUDENT role) to the group. */
export async function POST(request: Request, ctx: RouteContext<"/api/teacher/groups/[id]/members">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const res = await addMember(user, id, await readJson(request));
  if (!res.ok) return jsonError(res.error, res.status);
  const { group, student, added } = res.data;
  if (added) {
    await auditBy(user, request, {
      action: "group.member.add",
      entity: "Group",
      entityId: group.id,
      after: { group: group.name, studentId: student.id, student: student.login, fullName: student.fullName },
    });
  }
  return Response.json({ ok: true, added });
}
