import type { NextRequest } from "next/server";
import { apiUser } from "@/lib/auth/session";
import { practiceKey } from "@/lib/dds/api";
import { db } from "@/lib/db";
import { phoneState } from "@/lib/dds/calls";
import { closeLessonCalls, evaluateSeatPlates } from "@/lib/dds/review";
import { seatForUser, seatInfo } from "@/lib/dds/seat";
import { isBusyError } from "@/lib/dds/tx";
import { ensureDdsFlow, seatFeedWhere, settingsOf, type FlowInfo } from "@/lib/flow/dds-flow";

// The flow (new cards, other plates, crew calls) needs a resolution of seconds, not of every poll:
// each place moves it at most once per FLOW_TICK_MS; counters and the phone are still read fresh.
const FLOW_TICK_MS = Number(process.env.DDS_FLOW_TICK_MS ?? 2000);
const lastFlow = new Map<string, { at: number; info: FlowInfo }>();

async function throttledFlow(seatId: string): Promise<FlowInfo> {
  const now = Date.now();
  const cached = lastFlow.get(seatId);
  if (cached && now - cached.at < FLOW_TICK_MS) {
    const passed = Math.floor((now - cached.at) / 1000);
    const next = cached.info.nextCardInSec;
    return { ...cached.info, nextCardInSec: next == null ? null : Math.max(0, next - passed) };
  }
  const info = await ensureDdsFlow(seatId);
  lastFlow.set(seatId, { at: now, info });
  if (lastFlow.size > 2000) {
    for (const [id, v] of lastFlow) if (now - v.at > 600_000) lastFlow.delete(id);
  }
  return info;
}

/**
 * Heartbeat of the ДДС workstation, polled about once a second by the open screen: moves the flow
 * forward (new cards, other plates, crew calls) and returns the place, the clock, the counters and the phone.
 */
export async function GET(request: NextRequest) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const access = await seatForUser(user, request.nextUrl.searchParams.get("seat"), await practiceKey());
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
  // A step that could not get its turn at a busy moment is skipped: the next poll a second later makes it.
  const skipWhenBusy = (what: string) => (err: unknown) => {
    if (!isBusyError(err)) throw err;
    console.error(`dds ${what} skipped: the database is busy`, seat.id);
  };
  // The flow moves only from the owner's screen: a watching teacher must not deal cards.
  if (!readOnly) flow = (await throttledFlow(seat.id).catch(skipWhenBusy("flow step"))) ?? flow;
  // A finished lesson gets its calls closed and its review even if the teacher's side did not trigger it.
  if (seat.lesson.status === "FINISHED" && seat.studentId === user.id) {
    await closeLessonCalls(seat.lessonId);
    await evaluateSeatPlates(seat).catch(skipWhenBusy("final review"));
  }

  const waiting = seat.serviceId
    ? await db.incidentService.count({
        where: { serviceId: seat.serviceId, status: { in: ["ADDED", "RECEIVED"] }, incident: seatFeedWhere(seat) },
      })
    : 0;

  return Response.json({
    serverNow: new Date().toISOString(),
    seat: seatInfo(access, user.id),
    flow,
    waiting,
    phone: await phoneState(seat),
  });
}
