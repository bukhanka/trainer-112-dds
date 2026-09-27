import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scenarioLockedBy } from "@/lib/scenarios/lock";
import { scenarioPatchSchema } from "@/lib/scenarios/sections";
import { auditBy, jsonError, readJson, teacherApi } from "@/lib/teacher/access";

export async function GET(_request: Request, ctx: RouteContext<"/api/teacher/scenarios/[id]">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const scenario = await db.scenario.findUnique({ where: { id } });
  if (!scenario) return jsonError("Сценарий не найден", 404);
  return Response.json({ scenario, lockedBy: await scenarioLockedBy(scenario) });
}

/** Teacher's own edits of the persona and the reference. They keep the approvals: the teacher is the author. */
export async function PATCH(request: Request, ctx: RouteContext<"/api/teacher/scenarios/[id]">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const scenario = await db.scenario.findUnique({ where: { id } });
  if (!scenario) return jsonError("Сценарий не найден", 404);
  const locked = await scenarioLockedBy(scenario);
  if (locked) return jsonError(`Сценарий используется в идущем занятии «${locked}» — править его можно после окончания.`, 409);

  const parsed = scenarioPatchSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Неверные данные");
  const patch = parsed.data;
  // The reference card may name only real leaves of the classifier.
  const codes = [patch.truth?.typeCodes, patch.truth?.acceptableTypeCodes].flatMap((v) => (Array.isArray(v) ? v.map(Number) : []));
  if (codes.length) {
    const found = new Set((await db.incidentType.findMany({ where: { code: { in: codes.filter(Number.isInteger) } }, select: { code: true } })).map((t) => t.code));
    const unknown = [...new Set(codes)].filter((c) => !found.has(c));
    if (unknown.length) return jsonError(`Кода типа ${unknown.join(", ")} нет в классификаторе — выберите тип из классификатора.`);
  }
  const data: Prisma.ScenarioUpdateInput = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
    const value = patch[key];
    if (value === undefined) continue;
    before[key] = scenario[key] ?? null;
    after[key] = value;
    (data as Record<string, unknown>)[key] = value;
  }
  if (!Object.keys(after).length) return jsonError("Нечего сохранять");
  await db.scenario.update({ where: { id }, data });
  await auditBy(user, request, {
    action: "scenario.update",
    entity: "Scenario",
    entityId: id,
    before: before as Prisma.InputJsonValue,
    after: after as Prisma.InputJsonValue,
  });
  return Response.json({ ok: true });
}
