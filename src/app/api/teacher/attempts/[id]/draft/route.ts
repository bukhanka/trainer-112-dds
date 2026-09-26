import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { buildDraft } from "@/lib/review/ai-draft";
import { readCriteria, readOverrides } from "@/lib/review/draft";
import { attemptScope, auditBy, jsonError, teacherApi } from "@/lib/teacher/access";

/** Asks the model for a review draft (or builds one from the checks in mock mode). Does not change the score. */
export async function POST(request: Request, ctx: RouteContext<"/api/teacher/attempts/[id]/draft">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const attempt = await db.attempt.findFirst({ where: { id, ...attemptScope(user) }, select: { id: true, kind: true, criteria: true, override: true } });
  if (!attempt) return jsonError("Попытка не найдена", 404);

  const draft = await buildDraft(attempt.kind, readCriteria(attempt.criteria), readOverrides(attempt.override));
  await db.attempt.update({ where: { id }, data: { aiDraft: draft as unknown as Prisma.InputJsonValue } });
  await auditBy(user, request, { action: "attempt.draft", entity: "Attempt", entityId: id, after: { source: draft.source ?? "rules", model: draft.model ?? null } });
  return Response.json({ draft });
}
