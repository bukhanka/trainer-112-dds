import { z } from "zod";
import { db } from "@/lib/db";
import { switchRefusal } from "@/lib/review/corrections";
import { auditInTx, jsonError, readJson, teacherApi } from "@/lib/teacher/access";

const bodySchema = z.object({ active: z.boolean() });

class Refusal extends Error {}

/** Switch a teacher correction off (the model checks stop reading it) or back on. Author or administrator only. */
export async function POST(request: Request, ctx: RouteContext<"/api/teacher/corrections/[id]">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const parsed = bodySchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Неверный запрос");
  const { active } = parsed.data;

  const row = await db.teacherCorrection.findUnique({ where: { id }, select: { id: true, authorId: true, active: true, offReason: true, code: true } });
  if (!row) return jsonError("Правка не найдена", 404);
  const refusal = switchRefusal(user, row, active);
  if (refusal) return jsonError(refusal.error, refusal.status);
  if (row.active === active) return Response.json({ ok: true, active });

  try {
    await db.$transaction(async (tx) => {
      // Optimistic step: someone may have switched it a moment ago.
      const res = await tx.teacherCorrection.updateMany({
        where: { id, active: row.active },
        data: active
          ? { active: true, offAt: null, offById: null, offByName: null, offReason: null }
          : { active: false, offAt: new Date(), offById: user.id, offByName: user.fullName, offReason: "off" },
      });
      if (!res.count) throw new Refusal();
      await auditInTx(tx, user, request, {
        action: active ? "correction.on" : "correction.off",
        entity: "TeacherCorrection",
        entityId: id,
        before: { active: row.active, code: row.code },
        after: { active },
      });
    });
  } catch (err) {
    if (err instanceof Refusal) return jsonError("Правку только что изменили — обновите страницу", 409);
    throw err;
  }
  return Response.json({ ok: true, active });
}
