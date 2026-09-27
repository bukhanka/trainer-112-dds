import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { servicePhone } from "@/lib/dds/personas";
import { jsonError, op112User, ownIncident, readJson } from "@/lib/op112/access";
import { serviceCatalog } from "@/lib/op112/services";
import { readWorkLog, workOffInput, type WorkOff } from "@/lib/op112/workoffs";

// «Добавить отработку»: a row of the card's work-off journal — service, where, phone, who took it, the gist.
export async function POST(req: Request, ctx: RouteContext<"/api/op112/incidents/[id]/workoffs">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const own = await ownIncident(user, id);
  if (!own) return jsonError("not_found", 404);
  if (own.incident.status !== "registered") return jsonError("card_not_saved", 409);
  const body = workOffInput.safeParse(await readJson(req));
  if (!body.success) return jsonError("bad_request", 400);
  const r = body.data;

  // «Служба» comes only from the directory; a call id only from this card's own calls.
  const service = r.serviceId ? (await serviceCatalog()).find((s) => s.id === r.serviceId) : undefined;
  if (r.serviceId && !service) return jsonError("unknown_service", 400);
  const call = r.callId ? await db.call.findFirst({ where: { id: r.callId, incidentId: id, kind: "SERVICE_OUT" }, select: { id: true } }) : null;

  const phone = r.phone ?? (service ? servicePhone(service) : undefined);
  const entry: WorkOff = {
    id: randomUUID(),
    at: new Date().toISOString(),
    operator: own.incident.operatorNo ?? "",
    arm: own.incident.armNo ?? "",
    ...(service ? { serviceId: service.id, service: service.shortName } : {}),
    ...(r.where ? { where: r.where } : {}),
    ...(phone ? { phone } : {}),
    ...(r.acceptedBy ? { acceptedBy: r.acceptedBy } : {}),
    ...(r.summary ? { summary: r.summary } : {}),
    ...(call ? { callId: call.id } : {}),
  };
  // Appended in one statement, so two rows saved at once are both kept.
  const added = await db.$executeRaw`UPDATE "Incident" SET "workLog" = "workLog" || ${JSON.stringify([entry])}::jsonb WHERE id = ${id} AND status = 'registered'`;
  if (!added) return jsonError("card_not_saved", 409);
  const fresh = await db.incident.findUnique({ where: { id }, select: { workLog: true } });
  return Response.json({ workLog: readWorkLog(fresh?.workLog) });
}
