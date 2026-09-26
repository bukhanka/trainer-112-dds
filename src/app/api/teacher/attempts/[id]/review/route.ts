import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { readCriteria, readOverrides } from "@/lib/review/draft";
import { planReview, reviewActionSchema, RUNNING_LOCK } from "@/lib/review/review";
import { getActiveWeights, lockScores } from "@/lib/scoring/weights";
import { attemptScope, auditInTx, jsonError, readJson, teacherApi } from "@/lib/teacher/access";

class Refusal extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** «Верно» / «ИИ неправ» / «Вернуть на проверку». The decision and its audit record are written together. */
export async function POST(request: Request, ctx: RouteContext<"/api/teacher/attempts/[id]/review">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const parsed = reviewActionSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Неверный запрос");

  try {
    const next = await db.$transaction(async (tx) => {
      // Same lock as saving weights: the score below is computed with the weights that stay active.
      await lockScores(tx);
      const attempt = await tx.attempt.findFirst({
        where: { id, ...attemptScope(user) },
        include: { lesson: { select: { status: true } }, reviewedBy: { select: { login: true } } },
      });
      if (!attempt) throw new Refusal("Попытка не найдена", 404);
      if (attempt.lesson.status === "RUNNING") throw new Refusal(RUNNING_LOCK, 409);

      const criteria = readCriteria(attempt.criteria);
      const current = {
        reviewStatus: attempt.reviewStatus,
        override: readOverrides(attempt.override),
        score: attempt.score,
        teacherComment: attempt.teacherComment,
      };
      const { weights } = await getActiveWeights(tx);
      const plan = planReview(criteria, current, parsed.data, weights);
      if (!plan.ok) throw new Refusal(plan.error, 400);

      const reopened = plan.next.reviewStatus === "PENDING";
      // Optimistic check: nobody changed the decision since we read it, and the lesson was not restarted.
      const res = await tx.attempt.updateMany({
        where: { id, reviewStatus: attempt.reviewStatus, lesson: { status: { not: "RUNNING" } } },
        data: {
          reviewStatus: plan.next.reviewStatus,
          override: plan.next.override ?? Prisma.JsonNull,
          score: plan.next.score,
          teacherComment: plan.next.teacherComment,
          reviewedById: reopened ? null : user.id,
          reviewedAt: reopened ? null : new Date(),
        },
      });
      if (!res.count) throw new Refusal("Попытку только что изменили — обновите страницу", 409);

      const byCode = new Map(criteria.map((c) => [c.code, c]));
      await auditInTx(tx, user, request, {
        action: plan.auditAction,
        entity: "Attempt",
        entityId: id,
        before: { ...current, override: current.override ?? null, reviewedBy: attempt.reviewedBy?.login ?? null },
        after: {
          ...plan.next,
          override: plan.next.override ?? null,
          reviewedBy: reopened ? null : user.login,
          changes: plan.changed.map((code) => ({ code, title: byCode.get(code)?.title ?? code, from: byCode.get(code)?.ok ?? null, to: plan.next.override?.[code] ?? null })),
        },
      });
      return plan.next;
    });
    return Response.json({ ok: true, ...next });
  } catch (err) {
    if (err instanceof Refusal) return jsonError(err.message, err.status);
    throw err;
  }
}
