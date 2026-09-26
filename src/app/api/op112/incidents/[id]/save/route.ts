import { after } from "next/server";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { jsonError, op112User, ownIncident, readJson } from "@/lib/op112/access";
import { draftSchema } from "@/lib/op112/draft";
import { resolveDraft, routeDraft } from "@/lib/op112/panels";
import { gradeIncident, runAiReview } from "@/lib/op112/review";
import { mergeManual } from "@/lib/op112/routing";
import { serviceCatalog } from "@/lib/op112/services";
import { buildState } from "@/lib/op112/state";

// «оповестить и сохранить карточку»: the card is registered, service plates get «Добавлена», the
// ДДС places of the same lesson see it in their feed, and the operator's work is graded.
export async function POST(req: Request, ctx: RouteContext<"/api/op112/incidents/[id]/save">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const own = await ownIncident(user, id);
  if (!own) return jsonError("not_found", 404);
  if (own.incident.status !== "draft") return Response.json(await buildState(user));
  const body = draftSchema.safeParse((await readJson(req) as { draft?: unknown } | null)?.draft);
  if (!body.success) return jsonError("bad_request", 400);

  const d = body.data;
  const resolved = await resolveDraft(d);
  const plates = mergeManual(await routeDraft(d, resolved), d.manualServiceIds, await serviceCatalog());
  const now = new Date();
  const operator = `оп. ${own.incident.operatorNo ?? ""}`.trim();
  const aon = (own.incident.caller as { aon?: string } | null)?.aon;

  const claimed = await db.incident.updateMany({
    where: { id, status: "draft" },
    data: {
      status: "registered",
      savedAt: now,
      caller: { ...d.caller, aon: aon ?? d.caller.aon },
      address: d.address,
      flags: resolved.flags,
      tags: resolved.tags as unknown as Prisma.InputJsonValue,
      typeCodes: resolved.typeCodes,
      description: d.description,
      descriptionLog: d.description.trim() ? [{ at: now.toISOString(), author: operator, text: d.description.trim() }] : [],
    },
  });
  if (claimed.count === 0) return Response.json(await buildState(user));

  for (const p of plates) {
    await db.incidentService.create({
      data: {
        incidentId: id,
        serviceId: p.serviceId,
        isMain: p.isMain,
        addedBy: p.auto ? "auto" : "manual",
        status: "ADDED",
        addedAt: now,
        events: { create: { status: "ADDED", actorLabel: "оп. 0", at: now } },
      },
    });
  }
  // The conversation is over once the card is sent.
  await db.call.updateMany({ where: { incidentId: id, status: "ACTIVE" }, data: { status: "ENDED", endedAt: now } });

  const graded = await gradeIncident(id);
  if (graded?.aiPending) after(() => runAiReview(graded.attemptId));
  await audit({ action: "op112.card.save", actorId: user.id, actor: user.login, entity: "Incident", entityId: id, after: { services: plates.length } });
  return Response.json(await buildState(user));
}
