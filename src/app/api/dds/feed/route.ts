import type { NextRequest } from "next/server";
import { apiUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { seatForUser } from "@/lib/dds/seat";
import { feedRow, incidentInclude, typeInfos, type FeedRow } from "@/lib/dds/view";
import { ensureDdsFlow, seatFeedWhere, settingsOf, type FlowInfo } from "@/lib/flow/dds-flow";

const SHOW: Record<string, (r: FeedRow) => boolean> = {
  all: () => true,
  waiting: (r) => r.ownStatus === "ADDED" || r.ownStatus === "RECEIVED",
  work: (r) => !r.closed && r.ownStatus !== "ADDED" && r.ownStatus !== "RECEIVED",
  closed: (r) => r.closed,
};

/** Feed of the ДДС place. Each poll also moves the place's flow forward (new cards, other plates, crew calls). */
export async function GET(request: NextRequest) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const params = request.nextUrl.searchParams;
  const serverNow = new Date();

  const access = await seatForUser(user, params.get("seat"));
  if (!access) {
    const op112 = await db.seat.count({ where: { studentId: user.id, role: "OP112", lesson: { status: "RUNNING" } } });
    return Response.json({ serverNow: serverNow.toISOString(), seat: null, op112Running: op112 > 0 });
  }
  const { seat, readOnly } = access;
  const settings = settingsOf(seat.lesson.settings);

  let flow: FlowInfo = { running: seat.lesson.status === "RUNNING", queue: 0, maxQueue: settings.maxQueue, nextCardInSec: null, noScenarios: false };
  if (!readOnly) flow = await ensureDdsFlow(seat.id, serverNow);

  const incidents = await db.incident.findMany({
    where: seatFeedWhere(seat),
    include: incidentInclude,
    orderBy: [{ savedAt: "desc" }, { createdAt: "desc" }],
    take: 300,
  });
  const infos = await typeInfos(incidents);
  const rows = incidents
    .map((i) => (seat.serviceId ? feedRow(i, seat.serviceId, infos.get(i.id)!) : null))
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
    seat: {
      id: seat.id,
      label: seat.label,
      serviceId: seat.serviceId,
      serviceShort: seat.service?.shortName ?? "",
      serviceFull: seat.service?.fullName ?? seat.service?.shortName ?? "",
      studentName: seat.student.fullName,
      lessonId: seat.lessonId,
      lessonTitle: seat.lesson.title,
      lessonStatus: seat.lesson.status,
      practice: settings.practice,
      readOnly,
      ackSec: settings.ackSec,
      workSec: settings.workSec,
      tempoSec: settings.tempoSec,
      hints: settings.hints || settings.practice,
    },
    flow,
    rows: filtered.slice((page - 1) * size, page * size),
    total: filtered.length,
    waiting: rows.filter((r) => SHOW.waiting(r)).length,
    page,
    pages,
    size,
  });
}
