import { z } from "zod";
import { db } from "@/lib/db";
import { scenarioLockedBy } from "@/lib/scenarios/lock";
import { auditBy, jsonError, readJson, teacherApi } from "@/lib/teacher/access";

const bodySchema = z.object({ archived: z.boolean() });

/** «Удалить» for the teacher: the scenario goes to the archive, past attempts keep their link. */
export async function POST(request: Request, ctx: RouteContext<"/api/teacher/scenarios/[id]/archive">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const scenario = await db.scenario.findUnique({ where: { id } });
  if (!scenario) return jsonError("Сценарий не найден", 404);
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Неверный запрос");
  const { archived } = parsed.data;
  if (archived) {
    if (scenario.status === "ARCHIVED") return jsonError("Сценарий уже в архиве", 409);
    const locked = await scenarioLockedBy(scenario);
    if (locked) return jsonError(`Сценарий используется в идущем занятии «${locked}».`, 409);
  } else if (scenario.status !== "ARCHIVED") {
    // Only an archived scenario can be restored; anything else would silently drop its approvals.
    return jsonError("Сценарий не в архиве — обновите страницу", 409);
  }
  const status = archived ? "ARCHIVED" : "DRAFT";
  const res = await db.scenario.updateMany({
    where: { id, status: scenario.status },
    data: { status, ...(archived ? {} : { approvedSections: [] }) },
  });
  if (!res.count) return jsonError("Сценарий только что изменили — обновите страницу", 409);
  await auditBy(user, request, {
    action: archived ? "scenario.archive" : "scenario.restore",
    entity: "Scenario",
    entityId: id,
    before: { status: scenario.status },
    after: { status },
  });
  return Response.json({ ok: true, status });
}
