/** Ownership checks for the 112 API: a student acts only on calls and cards of their own seat. */
import { apiUser, type SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import type { Persona } from "./caller";
import { seatVisibleTo } from "./seat";
import { currentSessionId } from "./session-key";

export const jsonError = (error: string, status: number) => Response.json({ error }, { status });

export async function op112User(): Promise<SessionUser | Response> {
  return apiUser(["STUDENT", "TEACHER", "ADMIN"]);
}

/** Calls and cards of practice are visible only to the login session that started it. */
export async function ownCall(user: SessionUser, callId: string) {
  const call = await db.call.findUnique({ where: { id: callId }, include: { seat: { include: { lesson: true } } } });
  if (!call || call.kind !== "CALLER_IN" || !call.seat || call.seat.studentId !== user.id) return null;
  if (!seatVisibleTo(call.seat, await currentSessionId())) return null;
  return call;
}

/** A call from the work-off row of the student's own card (Call.kind = SERVICE_OUT). */
export async function ownServiceCall(user: SessionUser, callId: string) {
  const call = await db.call.findUnique({ where: { id: callId } });
  if (!call || call.kind !== "SERVICE_OUT" || !call.incidentId) return null;
  const own = await ownIncident(user, call.incidentId);
  return own ? { call, ...own } : null;
}

export async function ownIncident(user: SessionUser, incidentId: string) {
  const incident = await db.incident.findUnique({ where: { id: incidentId } });
  if (!incident?.createdBySeatId) return null;
  const seat = await db.seat.findUnique({ where: { id: incident.createdBySeatId }, include: { lesson: true } });
  if (!seat || seat.studentId !== user.id) return null;
  if (!seatVisibleTo(seat, await currentSessionId())) return null;
  return { incident, seat };
}

/** Parse a JSON body; malformed input becomes a 400 instead of a crash. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

type CallLike = { counterpart: unknown; incidentId: string | null };

/**
 * Who is on the line: the persona stored with the call, or the caller of its scenario (calls made
 * elsewhere — a teacher's lesson, the demo seed — may carry only a name).
 */
export async function personaOfCall(call: CallLike): Promise<Persona | undefined> {
  const cp = (call.counterpart ?? {}) as { persona?: Persona; scenarioId?: string };
  if (cp.persona?.situation) return cp.persona;
  const scenarioId =
    cp.scenarioId ??
    (call.incidentId ? (await db.incident.findUnique({ where: { id: call.incidentId }, select: { scenarioId: true } }))?.scenarioId : null);
  if (!scenarioId) return undefined;
  const scenario = await db.scenario.findUnique({ where: { id: scenarioId }, select: { caller: true } });
  const persona = scenario?.caller as Persona | null | undefined;
  return persona?.situation ? persona : undefined;
}
