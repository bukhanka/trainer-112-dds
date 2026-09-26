import { db } from "@/lib/db";
import { scenarioLockedBy } from "@/lib/scenarios/lock";
import { auditBy, jsonError, readJson, teacherApi } from "@/lib/teacher/access";

/** «Удалить» for the teacher: the scenario goes to the archive, past attempts keep their link. */
export async function POST(request: Request, ctx: RouteContext<"/api/teacher/scenarios/[id]/archive">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const scenario = await db.scenario.findUnique({ where: { id } });
  if (!scenario) return jsonError("Сценарий не найден", 404);
  const body = (await readJson(request)) as { archived?: unknown } | null;
  const archived = body?.archived === true;
  if (archived) {
    const locked = await scenarioLockedBy(scenario);
    if (locked) return jsonError(`Сценарий используется в идущем занятии «${locked}».`, 409);
  }
  const status = archived ? "ARCHIVED" : "DRAFT";
  await db.scenario.update({ where: { id }, data: { status, ...(archived ? {} : { approvedSections: [] }) } });
  await auditBy(user, request, {
    action: archived ? "scenario.archive" : "scenario.restore",
    entity: "Scenario",
    entityId: id,
    before: { status: scenario.status },
    after: { status },
  });
  return Response.json({ ok: true, status });
}
