import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { scenarioLockedBy } from "@/lib/scenarios/lock";
import { regenerateSection } from "@/lib/scenarios/regenerate";
import { nextApprovals, presentSections, sectionKeySchema, SECTIONS, statusFor } from "@/lib/scenarios/sections";
import { auditBy, jsonError, readJson, teacherApi } from "@/lib/teacher/access";

const bodySchema = z.object({ section: sectionKeySchema, comment: z.string().trim().min(3, "Напишите, что исправить").max(2000) });

/** «Исправь»: the teacher's remark goes to the model, the section comes back as a draft. */
export async function POST(request: Request, ctx: RouteContext<"/api/teacher/scenarios/[id]/regenerate">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const scenario = await db.scenario.findUnique({ where: { id } });
  if (!scenario) return jsonError("Сценарий не найден", 404);
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError(parsed.error.issues[0]?.message ?? "Неверный запрос");
  const locked = await scenarioLockedBy(scenario);
  if (locked) return jsonError(`Сценарий используется в идущем занятии «${locked}» — исправлять его можно после окончания.`, 409);

  const { section, comment } = parsed.data;
  const title = SECTIONS.find((s) => s.key === section)!.title;
  // The remark is kept in any case: it is the teacher's instruction for this scenario.
  const stamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" });
  const teacherNote = [scenario.teacherNote, `${stamp}, ${user.fullName} — «${title}»: ${comment}`].filter(Boolean).join("\n");

  const result = await regenerateSection(scenario, section, scenario[section], comment);
  if (!result.ok) {
    await db.scenario.update({ where: { id }, data: { teacherNote } });
    await auditBy(user, request, { action: "scenario.fix.requested", entity: "Scenario", entityId: id, after: { section, comment, generated: false } });
    return jsonError(result.error, result.mock ? 503 : 502);
  }

  const approvedSections = nextApprovals(scenario.approvedSections, [section], false);
  const status = statusFor(approvedSections, presentSections({ ...scenario, [section]: result.value }), scenario.status);
  await db.scenario.update({
    where: { id },
    data: { [section]: result.value as Prisma.InputJsonValue, approvedSections, status, teacherNote, approvedById: status === "APPROVED" ? scenario.approvedById : null },
  });
  await auditBy(user, request, {
    action: "scenario.regenerate",
    entity: "Scenario",
    entityId: id,
    before: { [section]: (scenario[section] ?? null) as Prisma.InputJsonValue, status: scenario.status },
    after: { [section]: result.value as Prisma.InputJsonValue, status, comment, model: result.model },
  });
  return Response.json({ ok: true, status, approvedSections });
}
