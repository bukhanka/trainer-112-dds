import { z } from "zod";
import { db } from "@/lib/db";
import { jsonError, op112User, ownIncident, readJson } from "@/lib/op112/access";
import { EMPTY_TEXT, gradeIncident } from "@/lib/op112/review";
import { buildState } from "@/lib/op112/state";

const bodySchema = z.object({ reason: z.enum(["noContact", "dropped"]) });

// «нет контакта» / «срыв звонка» → «сохранить карточку как пустую»: no services, closed at once.
export async function POST(req: Request, ctx: RouteContext<"/api/op112/incidents/[id]/empty">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const own = await ownIncident(user, id);
  if (!own) return jsonError("not_found", 404);
  const body = bodySchema.safeParse(await readJson(req));
  if (!body.success) return jsonError("bad_request", 400);
  const now = new Date();
  const claimed = await db.incident.updateMany({
    where: { id, status: "draft" },
    data: { status: "empty", savedAt: now, workedAt: now, description: EMPTY_TEXT[body.data.reason] },
  });
  if (claimed.count) {
    await db.call.updateMany({ where: { incidentId: id, status: "ACTIVE" }, data: { status: "ENDED", endedAt: now } });
    await gradeIncident(id);
  }
  return Response.json(await buildState(user));
}
