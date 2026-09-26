import { db } from "@/lib/db";
import { jsonError, op112User, ownCall } from "@/lib/op112/access";

// Handset button: the conversation ends, the card stays open for filling.
export async function POST(_req: Request, ctx: RouteContext<"/api/op112/calls/[id]/hangup">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const call = await ownCall(user, id);
  if (!call) return jsonError("not_found", 404);
  const now = new Date();
  await db.call.updateMany({ where: { id: call.id, status: "ACTIVE" }, data: { status: "ENDED", endedAt: now } });
  return Response.json({ ok: true, endedAt: now.toISOString() });
}
