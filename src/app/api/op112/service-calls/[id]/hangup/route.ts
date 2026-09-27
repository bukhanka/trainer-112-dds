import { db } from "@/lib/db";
import { jsonError, op112User, ownServiceCall } from "@/lib/op112/access";

// The handset in the chat of a work-off call: the conversation with the service ends.
export async function POST(_req: Request, ctx: RouteContext<"/api/op112/service-calls/[id]/hangup">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const own = await ownServiceCall(user, id);
  if (!own) return jsonError("not_found", 404);
  const now = new Date();
  await db.call.updateMany({ where: { id, status: "ACTIVE" }, data: { status: "ENDED", endedAt: now } });
  return Response.json({ ok: true, endedAt: now.toISOString() });
}
