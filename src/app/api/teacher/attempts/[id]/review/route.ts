import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { readCriteria, readOverrides } from "@/lib/review/draft";
import { planReview, reviewActionSchema, RUNNING_LOCK } from "@/lib/review/review";
import { getActiveWeights } from "@/lib/scoring/weights";
import { attemptScope, auditBy, jsonError, readJson, teacherApi } from "@/lib/teacher/access";

/** «Верно» / «ИИ неправ» / «Вернуть на проверку». Every decision goes to the audit journal. */
export async function POST(request: Request, ctx: RouteContext<"/api/teacher/attempts/[id]/review">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const attempt = await db.attempt.findFirst({
    where: { id, ...attemptScope(user) },
    include: { lesson: { select: { status: true } }, reviewedBy: { select: { login: true } } },
  });
  if (!attempt) return jsonError("Попытка не найдена", 404);
  if (attempt.lesson.status === "RUNNING") return jsonError(RUNNING_LOCK, 409);

  const parsed = reviewActionSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Неверный запрос");

  const criteria = readCriteria(attempt.criteria);
  const current = {
    reviewStatus: attempt.reviewStatus,
    override: readOverrides(attempt.override),
    score: attempt.score,
    teacherComment: attempt.teacherComment,
  };
  const { weights } = await getActiveWeights();
  const plan = planReview(criteria, current, parsed.data, weights);
  if (!plan.ok) return jsonError(plan.error);

  const reopened = plan.next.reviewStatus === "PENDING";
  const now = new Date();
  // Optimistic check: nobody changed the decision since we read it, and the lesson was not restarted.
  const res = await db.attempt.updateMany({
    where: { id, reviewStatus: attempt.reviewStatus, lesson: { status: { not: "RUNNING" } } },
    data: {
      reviewStatus: plan.next.reviewStatus,
      override: plan.next.override ?? Prisma.JsonNull,
      score: plan.next.score,
      teacherComment: plan.next.teacherComment,
      reviewedById: reopened ? null : user.id,
      reviewedAt: reopened ? null : now,
    },
  });
  if (!res.count) return jsonError("Попытку только что изменили — обновите страницу", 409);

  const titles = new Map(criteria.map((c) => [c.code, c]));
  await auditBy(user, request, {
    action: plan.auditAction,
    entity: "Attempt",
    entityId: id,
    before: { ...current, override: current.override ?? null, reviewedBy: attempt.reviewedBy?.login ?? null },
    after: {
      ...plan.next,
      override: plan.next.override ?? null,
      reviewedBy: reopened ? null : user.login,
      changes: plan.changed.map((code) => ({ code, title: titles.get(code)?.title ?? code, from: titles.get(code)?.ok ?? null, to: plan.next.override?.[code] ?? null })),
    },
  });
  return Response.json({ ok: true, ...plan.next });
}
