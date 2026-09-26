import { auditBy, jsonError, readJson, teacherApi } from "@/lib/teacher/access";
import { createGroup, groupSnapshot } from "@/lib/teacher/groups";

/** New group: a teacher's own; an administrator may name its teacher. */
export async function POST(request: Request) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const res = await createGroup(user, await readJson(request));
  if (!res.ok) return jsonError(res.error, res.status);
  await auditBy(user, request, { action: "group.create", entity: "Group", entityId: res.data.id, after: groupSnapshot(res.data) });
  return Response.json({ id: res.data.id }, { status: 201 });
}
