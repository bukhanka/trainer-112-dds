import { z } from "zod";
import { jsonError, op112User, ownIncident, readJson } from "@/lib/op112/access";
import { dialService } from "@/lib/op112/phone-calls";
import { serviceCallDto } from "@/lib/op112/state";

const bodySchema = z.object({ serviceId: z.number().int().positive() });

// The handset in the work-off row: the operator dials a service after «сохранить» and passes the card by phone.
export async function POST(req: Request, ctx: RouteContext<"/api/op112/incidents/[id]/workoffs/call">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const own = await ownIncident(user, id);
  if (!own) return jsonError("not_found", 404);
  // Work-offs belong to a saved card that is not closed yet («отработана» ends them).
  if (own.incident.status !== "registered") return jsonError("card_not_saved", 409);
  const body = bodySchema.safeParse(await readJson(req));
  if (!body.success) return jsonError("bad_request", 400);
  const call = await dialService(own.incident, own.seat.id, body.data.serviceId);
  if (!call) return jsonError("unknown_service", 400);
  return Response.json({ call: serviceCallDto(call) });
}
