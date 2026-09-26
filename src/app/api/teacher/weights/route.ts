import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { recomputeAllScores } from "@/lib/scoring/recompute";
import { getActiveWeights, runningLesson, weightsSchema } from "@/lib/scoring/weights";
import { auditBy, jsonError, readJson, teacherApi } from "@/lib/teacher/access";

export async function GET() {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const active = await getActiveWeights();
  return Response.json(active);
}

/** Save weights: a new active profile, every attempt rescored, one audit record with before and after. */
export async function POST(request: Request) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const body = (await readJson(request)) as { weights?: unknown } | null;
  const parsed = weightsSchema.safeParse(body?.weights);
  if (!parsed.success) return jsonError("Веса — числа от 0 до 5");
  const weights = parsed.data;
  if (!Object.values(weights).some((w) => w > 0)) return jsonError("Хотя бы одна группа должна иметь вес больше нуля");

  const running = await runningLesson();
  if (running) return jsonError(`Идёт занятие «${running.title}»: пока оно не закончится, веса не меняются, чтобы оценки не поменялись посреди работы. Предпросмотр доступен.`, 409);

  const before = await getActiveWeights();
  const stamp = new Date().toLocaleString("ru-RU", { timeZone: "Europe/Moscow", dateStyle: "short", timeStyle: "short" });
  const result = await db.$transaction(
    async (tx) => {
      await tx.weightProfile.updateMany({ where: { isActive: true }, data: { isActive: false } });
      const profile = await tx.weightProfile.create({
        data: { name: `${user.fullName}, ${stamp}`, weights: weights as Prisma.InputJsonValue, isActive: true },
      });
      const counts = await recomputeAllScores(tx, weights);
      return { profileId: profile.id, ...counts };
    },
    { timeout: 60_000 },
  );

  await auditBy(user, request, {
    action: "weights.update",
    entity: "WeightProfile",
    entityId: result.profileId,
    before: { profileId: before.profileId, weights: before.weights },
    after: { weights, attempts: result.total, rescored: result.changed },
  });
  return Response.json({ ok: true, ...result });
}
