import { auditBy, jsonError, readJson, teacherApi } from "@/lib/teacher/access";
import { groupSnapshot, updateGroup } from "@/lib/teacher/groups";

/** Rename, archive or restore a group; the administrator also changes its teacher. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/teacher/groups/[id]">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const res = await updateGroup(user, id, await readJson(request));
  if (!res.ok) return jsonError(res.error, res.status);
  const { before, after, changed } = res.data;
  if (changed) {
    const archived = !before.archivedAt && !!after.archivedAt;
    const restored = !!before.archivedAt && !after.archivedAt;
    await auditBy(user, request, {
      action: archived ? "group.archive" : restored ? "group.restore" : "group.update",
      entity: "Group",
      entityId: id,
      before: groupSnapshot(before),
      after: groupSnapshot(after),
    });
  }
  return Response.json({ id });
}
