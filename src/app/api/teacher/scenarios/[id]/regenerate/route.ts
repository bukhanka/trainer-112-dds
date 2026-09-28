import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { scenarioLockedBy } from "@/lib/scenarios/lock";
import { settleTruth, truthChoices } from "@/lib/scenarios/generate";
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

  // The reference card: the model chooses its type from a short list of classifier leaves (generate.ts, truthChoices).
  const extra = section === "truth" ? await truthChoices(scenario, comment) : undefined;
  const result = await regenerateSection(scenario, section, scenario[section], comment, extra);
  if (!result.ok) {
    await db.scenario.update({ where: { id }, data: { teacherNote } });
    await auditBy(user, request, { action: "scenario.fix.requested", entity: "Scenario", entityId: id, after: { section, comment, generated: false } });
    return jsonError(result.error, result.mock ? 503 : 502);
  }

  // The model may think for up to a minute: re-check the lock and write only over the version we read.
  const lockedNow = await scenarioLockedBy(scenario);
  if (lockedNow) return jsonError(`Пока ИИ работал, началось занятие «${lockedNow}» — сценарий не изменён.`, 409);
  // A new reference card brings its type into the classifier and rebuilds what follows from it:
  // services, the card at the ДДС place and the ДДС reference (generate.ts, settleTruth).
  const settled = section === "truth" ? await settleTruth(scenario, result.value, comment) : null;
  const written: Record<string, unknown> = settled
    ? { truth: settled.truth, ...(settled.changed.includes("ddsCard") ? { ddsCard: settled.ddsCard } : {}), ...(settled.changed.includes("ddsReference") ? { ddsReference: settled.ddsReference } : {}) }
    : { [section]: result.value };
  const approvedSections = nextApprovals(scenario.approvedSections, [section, ...(settled?.changed ?? [])], false);
  // What the rules did with the teacher's words (a service the classifier cannot give, a contradicting type) — kept and shown.
  const notes = settled?.notes ?? [];
  const noteLine = notes.length ? `${teacherNote} → ${notes.join("; ")}.` : teacherNote;
  const status = statusFor(approvedSections, presentSections({ ...scenario, ...written }), scenario.status);
  const res = await db.scenario.updateMany({
    where: { id, updatedAt: scenario.updatedAt },
    data: { ...(written as Prisma.ScenarioUpdateManyMutationInput), approvedSections, status, teacherNote: noteLine, approvedById: status === "APPROVED" ? scenario.approvedById : null },
  });
  if (!res.count) return jsonError("Сценарий изменили, пока ИИ работал. Обновите страницу и повторите.", 409);
  await auditBy(user, request, {
    action: "scenario.regenerate",
    entity: "Scenario",
    entityId: id,
    before: { [section]: (scenario[section] ?? null) as Prisma.InputJsonValue, status: scenario.status },
    after: { ...(written as Record<string, Prisma.InputJsonValue>), status, comment, model: result.model, notes },
  });
  return Response.json({ ok: true, status, approvedSections, notes });
}
