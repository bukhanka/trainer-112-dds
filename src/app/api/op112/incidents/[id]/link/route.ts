import { z } from "zod";
import { audit } from "@/lib/audit";
import { jsonError, op112User, ownIncident, readJson } from "@/lib/op112/access";
import { searchCards } from "@/lib/op112/links";
import { lessonCards, linkCard } from "@/lib/op112/links-db";

const bodySchema = z.object({ to: z.string().min(1).max(40).nullable() });

// «Создать связь» (Alt+W): the lesson's saved cards, searched by number, address or type.
export async function GET(req: Request, ctx: RouteContext<"/api/op112/incidents/[id]/link">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const own = await ownIncident(user, id);
  if (!own) return jsonError("not_found", 404);
  if (!own.incident.lessonId) return Response.json({ cards: [] });
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
  const cards = searchCards((await lessonCards(own.incident.lessonId, id)).map((c) => c.ref), q).slice(0, 30);
  return Response.json({ cards });
}

// «привязать» / «отвязать»: the card becomes subordinate to a main card of the same lesson, or free again.
export async function POST(req: Request, ctx: RouteContext<"/api/op112/incidents/[id]/link">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const own = await ownIncident(user, id);
  if (!own) return jsonError("not_found", 404);
  const body = bodySchema.safeParse(await readJson(req));
  if (!body.success) return jsonError("bad_request", 400);
  const r = await linkCard(own.incident, body.data.to);
  if (!r.ok) return jsonError(r.error, r.error === "not_found" ? 404 : 409);
  await audit({ action: body.data.to ? "op112.card.link" : "op112.card.unlink", actorId: user.id, actor: user.login, entity: "Incident", entityId: id, after: { linkedTo: r.main?.number ?? null } });
  return Response.json({ linkedTo: r.main });
}
