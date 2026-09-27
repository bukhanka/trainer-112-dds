import type { NextRequest } from "next/server";
import { apiUser } from "@/lib/auth/session";
import { practiceKey } from "@/lib/dds/api";
import { db } from "@/lib/db";
import { crewTimersFor } from "@/lib/dds/plate";
import { seatForUser } from "@/lib/dds/seat";
import { feedRow, incidentInclude, typeInfos, type FeedRow } from "@/lib/dds/view";
import { seatFeedWhere } from "@/lib/flow/dds-flow";

const SHOW: Record<string, (r: FeedRow) => boolean> = {
  all: () => true,
  waiting: (r) => r.ownStatus === "ADDED" || r.ownStatus === "RECEIVED",
  work: (r) => !r.closed && r.ownStatus !== "ADDED" && r.ownStatus !== "RECEIVED",
  closed: (r) => r.closed,
};

/** Feed of the ДДС place: newest first, filtered and paged. The flow itself moves in /api/dds/state. */
export async function GET(request: NextRequest) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const params = request.nextUrl.searchParams;

  const access = await seatForUser(user, params.get("seat"), await practiceKey());
  if (!access) {
    const op112 = await db.seat.count({ where: { studentId: user.id, role: "OP112", lesson: { status: "RUNNING" } } });
    return Response.json({ serverNow: new Date().toISOString(), seat: null, op112Running: op112 > 0 });
  }
  const { seat } = access;

  const incidents = await db.incident.findMany({
    where: seatFeedWhere(seat),
    include: incidentInclude,
    orderBy: [{ savedAt: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  const [infos, crews] = await Promise.all([typeInfos(incidents), crewTimersFor(seat, incidents)]);
  const rows = incidents
    .map((i) => (seat.serviceId ? feedRow(i, seat.serviceId, infos.get(i.id)!, crews.get(i.id) ?? null) : null))
    .filter((r): r is FeedRow => !!r);

  const q = (params.get("q") ?? "").trim().toLowerCase();
  const show = SHOW[params.get("show") ?? "all"] ?? SHOW.all;
  const filtered = rows.filter(
    (r) =>
      show(r) &&
      (!q ||
        [String(r.number), r.address, r.cardType, r.description?.text ?? "", r.ownLabel].some((v) => v.toLowerCase().includes(q))),
  );
  const size = Math.min(50, Math.max(5, Number(params.get("size")) || 10));
  const pages = Math.max(1, Math.ceil(filtered.length / size));
  const page = Math.min(pages, Math.max(1, Number(params.get("page")) || 1));

  return Response.json({
    serverNow: new Date().toISOString(),
    rows: filtered.slice((page - 1) * size, page * size),
    total: filtered.length,
    page,
    pages,
    size,
  });
}
