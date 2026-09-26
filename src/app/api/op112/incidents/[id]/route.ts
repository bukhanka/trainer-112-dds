import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { jsonError, op112User, ownIncident, readJson } from "@/lib/op112/access";
import { answersToTags, deriveFlags } from "@/lib/op112/card";
import { draftSchema } from "@/lib/op112/draft";

const patchSchema = z.object({ draft: draftSchema.optional(), important: z.boolean().optional() });

// Autosave of the card being filled. Only a draft can be edited; «important» can be toggled any time.
export async function PATCH(req: Request, ctx: RouteContext<"/api/op112/incidents/[id]">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const own = await ownIncident(user, id);
  if (!own) return jsonError("not_found", 404);
  const body = patchSchema.safeParse(await readJson(req));
  if (!body.success) return jsonError("bad_request", 400);

  if (body.data.important !== undefined) {
    await db.incident.update({ where: { id }, data: { important: body.data.important } });
  }
  if (body.data.draft) {
    const d = body.data.draft;
    const aon = (own.incident.caller as { aon?: string } | null)?.aon;
    // Only while still a draft: an autosave arriving after «сохранить» must not overwrite the saved card.
    const done = await db.incident.updateMany({
      where: { id, status: "draft" },
      data: {
        caller: { ...d.caller, aon: aon ?? d.caller.aon },
        address: d.address,
        flags: deriveFlags(d.flags, d.cards, d.answers),
        tags: answersToTags(d.cards, d.answers) as unknown as Prisma.InputJsonValue,
        description: d.description,
      },
    });
    if (done.count === 0) return jsonError("card_saved", 409);
  }
  return Response.json({ ok: true, savedAt: new Date().toISOString() });
}
