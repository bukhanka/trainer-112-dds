import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { bulkConfirmSchema, planBulkConfirm } from "@/lib/review/bulk";
import { syncCorrections } from "@/lib/review/corrections-db";
import { readCriteria, readOverrides } from "@/lib/review/draft";
import { planReview, RUNNING_LOCK } from "@/lib/review/review";
import { getActiveWeights, lockScores } from "@/lib/scoring/weights";
import { attemptScope, auditInTx, findLesson, jsonError, readJson, requestIp, teacherApi } from "@/lib/teacher/access";

class Refusal extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/**
 * «Утвердить выбранные» / «Утвердить все без критичных ошибок»: the chosen attempts of one lesson are confirmed as they
 * are — each with the decision «Верно» gives and its own audit record, all in one transaction; the attempts that need a
 * look stay on review (src/lib/review/bulk.ts). Access is the one of a single decision: own lessons, an administrator all.
 */
export async function POST(request: Request, ctx: RouteContext<"/api/teacher/lessons/[id]/attempts/confirm">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const lesson = await findLesson(user, id);
  if (!lesson) return jsonError("Занятие не найдено", 404);
  const parsed = bulkConfirmSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Неверный запрос");
  if (lesson.status === "RUNNING") return jsonError(RUNNING_LOCK, 409);
  const { ids, noCritical } = parsed.data;

  try {
    const result = await db.$transaction(
      async (tx) => {
        // Same lock as a single decision and saving weights: the scores below use the weights that stay active.
        await lockScores(tx);
        const rows = await tx.attempt.findMany({
          where: { id: { in: [...new Set(ids)] }, lessonId: id, ...attemptScope(user) },
          select: {
            id: true,
            reviewStatus: true,
            criteria: true,
            override: true,
            score: true,
            teacherComment: true,
            reviewedBy: { select: { login: true } },
            lesson: { select: { status: true } },
          },
        });
        if (rows.some((r) => r.lesson.status === "RUNNING")) throw new Refusal(RUNNING_LOCK, 409);
        const byId = new Map(rows.map((r) => [r.id, r]));
        const plan = planBulkConfirm(
          ids,
          rows.map((r) => ({ id: r.id, reviewStatus: r.reviewStatus, criteria: readCriteria(r.criteria), override: readOverrides(r.override), teacherComment: r.teacherComment })),
          noCritical,
        );
        const { weights } = await getActiveWeights(tx);
        // Corrections of an attempt are retired by «Верно» as by a single decision (normally there are none here).
        const withCorrections = plan.confirm.length
          ? new Set(
              (await tx.teacherCorrection.findMany({ where: { attemptId: { in: plan.confirm.map((a) => a.id) }, active: true }, select: { attemptId: true } })).map(
                (c) => c.attemptId,
              ),
            )
          : new Set<string | null>();

        const now = new Date();
        const ip = requestIp(request);
        const records: Prisma.AuditLogCreateManyInput[] = [];
        let confirmed = 0;
        for (const a of plan.confirm) {
          const row = byId.get(a.id)!;
          const current = { reviewStatus: a.reviewStatus, override: a.override, score: row.score, teacherComment: row.teacherComment };
          const decision = planReview(a.criteria, current, { action: "confirm" }, weights);
          if (!decision.ok) continue;
          // Optimistic check, as for a single decision: still on review, the lesson not running.
          const res = await tx.attempt.updateMany({
            where: { id: a.id, reviewStatus: "PENDING", lesson: { status: { not: "RUNNING" } } },
            data: {
              reviewStatus: decision.next.reviewStatus,
              override: Prisma.JsonNull,
              score: decision.next.score,
              teacherComment: decision.next.teacherComment,
              reviewedById: user.id,
              reviewedAt: now,
            },
          });
          if (!res.count) {
            plan.skipped.decided++;
            continue;
          }
          const corrections = withCorrections.has(a.id)
            ? await syncCorrections(tx, user, request, { attemptId: a.id, criteria: a.criteria, next: decision.next })
            : { created: 0, retired: 0 };
          records.push({
            action: decision.auditAction,
            entity: "Attempt",
            entityId: a.id,
            actorId: user.id,
            actor: user.login,
            ip,
            before: { ...current, override: null, reviewedBy: row.reviewedBy?.login ?? null },
            after: { ...decision.next, override: null, reviewedBy: user.login, changes: [], corrections, via: "bulk" },
          });
          confirmed++;
        }
        if (records.length) await tx.auditLog.createMany({ data: records });
        await auditInTx(tx, user, request, {
          action: "attempt.bulk_confirm",
          entity: "Lesson",
          entityId: id,
          // What was left, only where there is something: «с критичной ошибкой: 2».
          after: {
            confirmed,
            noCritical,
            ...(plan.skipped.critical ? { skippedCritical: plan.skipped.critical } : {}),
            ...(plan.skipped.edited ? { skippedEdited: plan.skipped.edited } : {}),
            ...(plan.skipped.decided ? { skippedDecided: plan.skipped.decided } : {}),
            ...(plan.skipped.missing ? { skippedMissing: plan.skipped.missing } : {}),
          },
        });
        return { confirmed, skipped: plan.skipped };
      },
      // Hundreds of attempts of a class: more than the default five seconds.
      { timeout: 60_000, maxWait: 10_000 },
    );
    return Response.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof Refusal) return jsonError(err.message, err.status);
    throw err;
  }
}
