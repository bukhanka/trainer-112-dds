import { z } from "zod";
import { db } from "@/lib/db";
import { jsonError, op112User, ownIncident, readJson } from "@/lib/op112/access";
import { phonePlates } from "@/lib/op112/evaluate";
import { phoneCallOf, regradePhone } from "@/lib/op112/review";
import { serviceCatalog } from "@/lib/op112/services";
import { buildState } from "@/lib/op112/state";
import { phoneNotices, readWorkLog, unfinishedNotices, type PhoneCall } from "@/lib/op112/workoffs";

const bodySchema = z.object({ confirm: z.boolean().optional() }).nullable();

// «отработана»: the operator has finished with the card; the place is free for the next call. A service that gets
// cards only by phone and was not called (or the call is not written down) stops it once with a warning; the
// operator may still close the card, and the review then marks the service as not notified.
export async function POST(req: Request, ctx: RouteContext<"/api/op112/incidents/[id]/worked">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const own = await ownIncident(user, id);
  if (!own) return jsonError("not_found", 404);
  const body = bodySchema.safeParse(await readJson(req));
  const confirm = body.success && Boolean(body.data?.confirm);

  if (own.incident.status === "registered" && !confirm) {
    const [plates, calls] = await Promise.all([
      db.incidentService.findMany({ where: { incidentId: id }, select: { serviceId: true } }),
      db.call.findMany({ where: { incidentId: id, kind: "SERVICE_OUT" } }),
    ]);
    const phoneOnly = phonePlates({ serviceIds: plates.map((p) => p.serviceId), catalog: await serviceCatalog() });
    const notices = phoneNotices(phoneOnly, calls.map(phoneCallOf).filter((c): c is PhoneCall => c !== null), readWorkLog(own.incident.workLog));
    const missing = unfinishedNotices(notices);
    if (missing.length) return Response.json({ error: "phone_not_notified", missing }, { status: 409 });
  }

  const now = new Date();
  const closed = await db.$transaction(async (tx) => {
    const r = await tx.incident.updateMany({ where: { id, status: "registered" }, data: { status: "worked", workedAt: now } });
    if (r.count) await tx.call.updateMany({ where: { incidentId: id, kind: "SERVICE_OUT", status: "ACTIVE" }, data: { status: "ENDED", endedAt: now } });
    return r.count > 0;
  });
  if (closed) await regradePhone(id);
  return Response.json(await buildState(user));
}
