import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { ddsContext } from "@/lib/dds/api";
import { findSeatIncident, markReceived } from "@/lib/dds/plate";
import { allowedNext, normMoments, rulesFor, STATUS_LABEL } from "@/lib/dds/status";
import { cardView, incidentInclude, typeInfos } from "@/lib/dds/view";

/** Card of the place. The first open by the dispatcher sets «Получена службой» on their plate. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/dds/incidents/[number]">) {
  const dds = await ddsContext(request);
  if (dds instanceof Response) return dds;
  const { seat, readOnly } = dds.access;
  const found = await findSeatIncident(seat, Number((await ctx.params).number));
  if (!found) return Response.json({ error: "not_found", message: "Карточка не найдена на вашем месте" }, { status: 404 });

  if (!readOnly) await markReceived(seat, found.id);
  const incident = await db.incident.findUniqueOrThrow({ where: { id: found.id }, include: incidentInclude });
  const info = (await typeInfos([incident])).get(incident.id)!;
  const card = cardView(incident, seat.serviceId, info);
  const own = card.plates.find((p) => p.own) ?? null;
  const rules = rulesFor(seat.service);
  const ownRow = incident.services.find((p) => p.serviceId === seat.serviceId);
  const moments = ownRow ? normMoments(ownRow.events) : null;

  return Response.json({
    serverNow: new Date().toISOString(),
    card,
    own: own && {
      plateId: own.id,
      status: own.status,
      crewNumber: own.crewNumber,
      noReject: rules.noReject,
      editable: !readOnly && allowedNext(own.status, rules).length > 0,
      options: allowedNext(own.status, rules).map((s) => ({ value: s, label: STATUS_LABEL[s] })),
      addedAt: own.addedAt,
      openedAt: moments?.openedAt?.toISOString() ?? null,
      recordAt: moments?.recordAt?.toISOString() ?? null,
    },
  });
}
