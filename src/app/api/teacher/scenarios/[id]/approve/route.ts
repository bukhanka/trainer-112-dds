import { z } from "zod";
import { db } from "@/lib/db";
import { scenarioLockedBy } from "@/lib/scenarios/lock";
import { nextApprovals, presentSections, sectionKeySchema, statusFor } from "@/lib/scenarios/sections";
import { auditBy, jsonError, readJson, teacherApi } from "@/lib/teacher/access";

const bodySchema = z.object({
  sections: z.union([z.literal("all"), z.array(sectionKeySchema).min(1)]),
  approve: z.boolean(),
});

/** Approve (or withdraw) the whole scenario or single sections. */
export async function POST(request: Request, ctx: RouteContext<"/api/teacher/scenarios/[id]/approve">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const scenario = await db.scenario.findUnique({ where: { id } });
  if (!scenario) return jsonError("Сценарий не найден", 404);
  if (scenario.status === "ARCHIVED") return jsonError("Сценарий в архиве — сначала верните его из архива", 409);
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Неверный запрос");
  const { approve } = parsed.data;
  const present = presentSections(scenario);
  const sections = parsed.data.sections === "all" ? present : parsed.data.sections;
  if (!approve) {
    const locked = await scenarioLockedBy(scenario);
    if (locked) return jsonError(`Сценарий используется в идущем занятии «${locked}» — снять утверждение можно после окончания.`, 409);
  }

  const approvedSections = nextApprovals(scenario.approvedSections, sections, approve);
  const status = statusFor(approvedSections, present, scenario.status);
  await db.scenario.update({
    where: { id },
    data: { approvedSections, status, approvedById: status === "APPROVED" ? user.id : null },
  });
  await auditBy(user, request, {
    action: approve ? "scenario.approve" : "scenario.unapprove",
    entity: "Scenario",
    entityId: id,
    before: { status: scenario.status, approvedSections: scenario.approvedSections },
    after: { status, approvedSections, sections },
  });
  return Response.json({ ok: true, status, approvedSections });
}
