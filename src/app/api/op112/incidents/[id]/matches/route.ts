import { z } from "zod";
import { jsonError, op112User, ownIncident, readJson } from "@/lib/op112/access";
import { addressSchema, callerSchema } from "@/lib/op112/draft";
import { db } from "@/lib/db";
import { findMatches, phoneMatchLink } from "@/lib/op112/links";
import { situationOf } from "@/lib/scenarios/pairs";
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
  const scenario = own.incident.scenarioId ? await db.scenario.findUnique({ where: { id: own.incident.scenarioId }, select: { id: true, ticketRef: true } }) : null;
  const card = { id, caller: { ...body.data.caller, aon: aon ?? body.data.caller.aon }, address: body.data.address, situation: scenario ? situationOf(scenario) : null };
  const m = findMatches(card, cards);
  // By the number alone a card is shown, but it is linked only when the place is the same (links.ts).
  return Response.json({ byPhone: m.byPhone.map((c) => ({ ...c.ref, link: phoneMatchLink(card, c) })), byAddress: m.byAddress.map((c) => c.ref) });
}
