import { db } from "@/lib/db";
import { jsonError, op112User, ownIncident } from "@/lib/op112/access";
import { buildState } from "@/lib/op112/state";

// «отработана»: the operator has finished with the card; the place is free for the next call.
export async function POST(_req: Request, ctx: RouteContext<"/api/op112/incidents/[id]/worked">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const own = await ownIncident(user, id);
  if (!own) return jsonError("not_found", 404);
  await db.incident.updateMany({ where: { id, status: "registered" }, data: { status: "worked", workedAt: new Date() } });
  return Response.json(await buildState(user));
}
