import { auditBy, jsonError, teacherApi } from "@/lib/teacher/access";
import { removeMember } from "@/lib/teacher/groups";

/** Take a student out of the group (and out of the group's draft lessons). Results stay. */
export async function DELETE(request: Request, ctx: RouteContext<"/api/teacher/groups/[id]/members/[userId]">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id, userId } = await ctx.params;
  const res = await removeMember(user, id, userId);
  if (!res.ok) return jsonError(res.error, res.status);
  const { group, student, seatsRemoved } = res.data;
  await auditBy(user, request, {
    action: "group.member.remove",
    entity: "Group",
    entityId: group.id,
    before: { group: group.name, studentId: student.id, student: student.login, fullName: student.fullName },
    after: { draftSeatsRemoved: seatsRemoved },
  });
  return Response.json({ ok: true, seatsRemoved });
}
