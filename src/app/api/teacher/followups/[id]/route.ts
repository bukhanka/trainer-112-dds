import { z } from "zod";
import { db } from "@/lib/db";
import { auditInTx, jsonError, readJson, teacherApi } from "@/lib/teacher/access";
import { readCriteria, readOverrides } from "@/lib/review/draft";
import { effectiveChecks, goalEvidenceSchema, goalOutcome, reviewDigest, type SkillKey } from "@/lib/followup/skills";
import { followUpState, loadFollowUp, sourceIsCurrent } from "@/lib/followup/state";

const changeSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("cancel"), reason: z.string().trim().min(5).max(500) }),
  z.object({ action: z.literal("observe"), stage: z.enum(["practice", "control"]), attemptId: z.string().min(1), observed: z.boolean(), evidence: z.string().trim().min(12).max(1000) }),
]);

export async function GET(_request: Request, ctx: RouteContext<"/api/teacher/followups/[id]">) {
  const user = await teacherApi(); if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const link = await loadFollowUp(db, id);
  if (!link || (user.role !== "ADMIN" && link.sourceAttempt.lessonId && link.practiceLesson.teacherId !== user.id)) return jsonError("Назначение не найдено", 404);
  return Response.json({ id, skillKey: link.skillKey, state: await followUpState(db, link), practiceLessonId: link.practiceLessonId, controlLessonId: link.controlLessonId });
}

export async function PATCH(request: Request, ctx: RouteContext<"/api/teacher/followups/[id]">) {
  const user = await teacherApi(); if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const parsed = changeSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Укажите наблюдение или причину отмены");
  const result = await db.$transaction(async (tx) => {
    const link = await loadFollowUp(tx, id);
    if (!link || (user.role !== "ADMIN" && link.practiceLesson.teacherId !== user.id)) return { status: 404, error: "Назначение не найдено" };
    if (link.cancelledAt) return { status: 409, error: "Назначение уже отменено" };
    if (parsed.data.action === "cancel") {
      if (link.practiceLesson.status === "DRAFT") await tx.seat.deleteMany({ where: { lessonId: link.practiceLessonId, studentId: link.sourceAttempt.studentId } });
      if (link.controlLesson.status === "DRAFT") await tx.seat.deleteMany({ where: { lessonId: link.controlLessonId, studentId: link.sourceAttempt.studentId } });
      await tx.followUp.update({ where: { id }, data: { cancelledAt: new Date(), cancellationReason: parsed.data.reason } });
      await auditInTx(tx, user, request, { action: "followup.cancel", entity: "FollowUp", entityId: id, after: { reason: parsed.data.reason } });
      return { ok: true, state: "cancelled" };
    }
    if (!sourceIsCurrent(link)) return { status: 409, error: "Исходный разбор изменён" };
    const stage = parsed.data.stage;
    const lesson = stage === "practice" ? link.practiceLesson : link.controlLesson;
    if (lesson.status !== "FINISHED") return { status: 409, error: "Сначала завершите занятие" };
    const attempt = await tx.attempt.findFirst({ where: {
      id: parsed.data.attemptId, lessonId: lesson.id, studentId: link.sourceAttempt.studentId, reviewStatus: { not: "PENDING" },
    } });
    if (!attempt || !attempt.reviewedAt) return { status: 409, error: "Сначала преподаватель должен проверить эту попытку" };
    const snap = link.sourceSnapshot as { practiceScenarioId?: string; controlScenarioId?: string };
    const expected = stage === "practice" ? snap.practiceScenarioId : snap.controlScenarioId;
    if (attempt.scenarioId !== expected) return { status: 409, error: "Попытка относится к другому заданию" };
    const evidence = goalEvidenceSchema.parse({ attemptId: attempt.id,
      reviewDigest: reviewDigest({ criteria: readCriteria(attempt.criteria), override: readOverrides(attempt.override), reviewedAt: attempt.reviewedAt, teacherComment: attempt.teacherComment }),
      observed: parsed.data.observed, evidence: parsed.data.evidence, reviewedById: user.id, reviewedAt: new Date().toISOString() });
    const outcome = goalOutcome(link.skillKey as SkillKey, effectiveChecks(readCriteria(attempt.criteria), readOverrides(attempt.override)), evidence);
    await tx.followUp.update({ where: { id }, data: { [stage === "practice" ? "practiceJudgment" : "controlJudgment"]: evidence } });
    await auditInTx(tx, user, request, { action: "followup.observe", entity: "FollowUp", entityId: id, after: { stage, attemptId: attempt.id, observed: evidence.observed, outcome } });
    return { ok: true, outcome };
  });
  if ("error" in result && typeof result.error === "string") return jsonError(result.error, result.status);
  return Response.json(result);
}
