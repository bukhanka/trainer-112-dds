import { z } from "zod";
import { jsonError, op112User, ownIncident, readJson } from "@/lib/op112/access";
import { addressSchema, callerSchema } from "@/lib/op112/draft";
import { findMatches } from "@/lib/op112/links";
import { lessonCards } from "@/lib/op112/links-db";

const bodySchema = z.object({ caller: callerSchema.default({}), address: addressSchema.default({}) });

// «Совпадение»: saved cards of the lesson with the same phone number (the button in the АОН block) or the same
// place (the button in the address block) as the card being filled.
export async function POST(req: Request, ctx: RouteContext<"/api/op112/incidents/[id]/matches">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const own = await ownIncident(user, id);
  if (!own) return jsonError("not_found", 404);
  const body = bodySchema.safeParse(await readJson(req));
  if (!body.success) return jsonError("bad_request", 400);
  if (!own.incident.lessonId) return Response.json({ byPhone: [], byAddress: [] });
  const aon = (own.incident.caller as { aon?: string } | null)?.aon;
  const cards = (await lessonCards(own.incident.lessonId, id)).map((c) => ({ ...c, id: c.ref.id }));
  const m = findMatches({ id, caller: { ...body.data.caller, aon: aon ?? body.data.caller.aon }, address: body.data.address }, cards);
  return Response.json({ byPhone: m.byPhone.map((c) => c.ref), byAddress: m.byAddress.map((c) => c.ref) });
}
