import type { NextRequest } from "next/server";
import { apiUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { phoneState } from "@/lib/dds/calls";
import { seatForUser, seatInfo } from "@/lib/dds/seat";
import { ensureDdsFlow, seatFeedWhere, settingsOf, type FlowInfo } from "@/lib/flow/dds-flow";

/**
 * Heartbeat of the ДДС workstation, polled about once a second by the open screen: moves the flow
 * forward (new cards, other plates, crew calls) and returns the place, the clock, the counters and the phone.
 */
export async function GET(request: NextRequest) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const access = await seatForUser(user, request.nextUrl.searchParams.get("seat"));
  if (!access) {
    const op112 = await db.seat.count({ where: { studentId: user.id, role: "OP112", lesson: { status: "RUNNING" } } });
    return Response.json({ serverNow: new Date().toISOString(), seat: null, op112Running: op112 > 0 });
  }
  const { seat, readOnly } = access;
  const settings = settingsOf(seat.lesson.settings);
  let flow: FlowInfo = {
    running: seat.lesson.status === "RUNNING",
    queue: 0,
    maxQueue: settings.maxQueue,
    nextCardInSec: null,
    noScenarios: false,
  };
  // The flow moves only from the owner's screen: a watching teacher must not deal cards.
  if (!readOnly) flow = await ensureDdsFlow(seat.id);

  const waiting = seat.serviceId
    ? await db.incidentService.count({
        where: { serviceId: seat.serviceId, status: { in: ["ADDED", "RECEIVED"] }, incident: seatFeedWhere(seat) },
      })
    : 0;

  return Response.json({
    serverNow: new Date().toISOString(),
    seat: seatInfo(access),
    flow,
    waiting,
    phone: await phoneState(seat),
  });
}
