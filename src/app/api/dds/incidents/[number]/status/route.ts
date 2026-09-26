import type { NextRequest } from "next/server";
import { z } from "zod";
import { ddsContext, badRequest } from "@/lib/dds/api";
import { findSeatIncident, setOwnStatus } from "@/lib/dds/plate";
import { ALL_STATUSES } from "@/lib/dds/status";

const bodySchema = z.object({
  status: z.enum(ALL_STATUSES as [string, ...string[]]),
  crewNumber: z.string().max(100).nullish(),
  comment: z.string().max(4000).nullish(),
});

/** Status line of the own plate: Статус | Номер наряда | Комментарий. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/dds/incidents/[number]/status">) {
  const dds = await ddsContext(request, { write: true });
  if (dds instanceof Response) return dds;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return badRequest("Неверный запрос");

  const { seat } = dds.access;
  const found = await findSeatIncident(seat, Number((await ctx.params).number));
  if (!found) return Response.json({ error: "not_found", message: "Карточка не найдена на вашем месте" }, { status: 404 });

  const res = await setOwnStatus(dds.user, seat, found.id, {
    status: body.data.status as (typeof ALL_STATUSES)[number],
    crewNumber: body.data.crewNumber,
    comment: body.data.comment,
  });
  if (!res.ok) return Response.json({ error: "rejected", message: res.error }, { status: res.code });
  return Response.json(res);
}
