import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import type { DescriptionEntry, IncidentAddress, IncidentCaller, IncidentFlags } from "@/lib/incident/types";
import { jsonError, op112User, ownIncident, readJson } from "@/lib/op112/access";
import { draftSchema } from "@/lib/op112/draft";
import { resolveDraft } from "@/lib/op112/panels";
import { buildState } from "@/lib/op112/state";
import { applySupplement } from "@/lib/op112/supplement";

const bodySchema = z.object({ draft: draftSchema });

// «Дополнить» → «сохранить»: fields empty at saving, the description and the victims flag of a saved card. The
// change goes to the card's description journal, so the ДДС places see it next to the first entry.
export async function POST(req: Request, ctx: RouteContext<"/api/op112/incidents/[id]/supplement">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const own = await ownIncident(user, id);
  if (!own) return jsonError("not_found", 404);
  if (own.incident.status !== "registered") return jsonError("card_not_saved", 409);
  const body = bodySchema.safeParse(await readJson(req));
  if (!body.success) return jsonError("bad_request", 400);

  const inc = own.incident;
  const flags = (inc.flags ?? {}) as IncidentFlags;
  // «Пострадавшие» is the top button plus any panel row that says so; the panels themselves are not edited here.
  const d = body.data.draft;
  const resolved = await resolveDraft({ cards: d.cards, answers: d.answers, flags: { victims: d.flags.victims }, address: d.address });
  const s = applySupplement(
    {
      caller: (inc.caller ?? {}) as IncidentCaller,
      address: (inc.address ?? {}) as IncidentAddress,
      victims: Boolean(flags.victims),
      description: inc.description ?? "",
    },
    { caller: d.caller, address: d.address, victims: Boolean(resolved.flags.victims), description: d.description },
  );
  if (!s.entry) return Response.json(await buildState(user));

  const now = new Date();
  const log = (Array.isArray(inc.descriptionLog) ? inc.descriptionLog : []) as DescriptionEntry[];
  const operator = inc.operatorNo ? `оп. ${inc.operatorNo}` : "оп.";
  const entry: DescriptionEntry = { at: now.toISOString(), author: `${operator}, дополнение`, text: s.entry };
  const done = await db.incident.updateMany({
    where: { id, status: "registered" },
    data: {
      caller: s.caller as Prisma.InputJsonValue,
      address: s.address as Prisma.InputJsonValue,
      flags: { ...flags, victims: s.victims } as Prisma.InputJsonValue,
      description: s.description,
      descriptionLog: [...log, entry] as unknown as Prisma.InputJsonValue,
    },
  });
  if (!done.count) return jsonError("card_not_saved", 409);
  await audit({ action: "op112.card.supplement", actorId: user.id, actor: user.login, entity: "Incident", entityId: id, after: { entry: s.entry.slice(0, 200) } });
  return Response.json(await buildState(user));
}
