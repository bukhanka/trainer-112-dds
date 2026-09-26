import { db } from "@/lib/db";
import { jsonError, op112User, ownCall } from "@/lib/op112/access";

// The operator rejected a ringing call; it is kept as missed.
export async function POST(_req: Request, ctx: RouteContext<"/api/op112/calls/[id]/decline">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const call = await ownCall(user, id);
  if (!call) return jsonError("not_found", 404);
  await db.call.updateMany({ where: { id: call.id, status: "RINGING" }, data: { status: "MISSED", endedAt: new Date() } });
  return Response.json({ ok: true });
}
