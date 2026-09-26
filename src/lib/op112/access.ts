/** Ownership checks for the 112 API: a student acts only on calls and cards of their own seat. */
import { apiUser, type SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

export const jsonError = (error: string, status: number) => Response.json({ error }, { status });

export async function op112User(): Promise<SessionUser | Response> {
  return apiUser(["STUDENT", "TEACHER", "ADMIN"]);
}

export async function ownCall(user: SessionUser, callId: string) {
  const call = await db.call.findUnique({ where: { id: callId }, include: { seat: { include: { lesson: true } } } });
  if (!call || call.kind !== "CALLER_IN" || !call.seat || call.seat.studentId !== user.id) return null;
  return call;
}

export async function ownIncident(user: SessionUser, incidentId: string) {
  const incident = await db.incident.findUnique({ where: { id: incidentId } });
  if (!incident?.createdBySeatId) return null;
  const seat = await db.seat.findUnique({ where: { id: incident.createdBySeatId }, include: { lesson: true } });
  if (!seat || seat.studentId !== user.id) return null;
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
