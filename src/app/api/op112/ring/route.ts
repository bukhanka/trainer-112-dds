import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { CallerPersona } from "@/lib/incident/types";
import { jsonError, op112User } from "@/lib/op112/access";
import { distinctCaller } from "@/lib/op112/identity";
import { lessonCallers } from "@/lib/op112/identity-db";
import { drawCall, findActiveSeat, repeatOf } from "@/lib/op112/seat";
import { situationOf } from "@/lib/scenarios/pairs";
import { currentSessionId } from "@/lib/op112/session-key";
import { callDto } from "@/lib/op112/state";

function randomPhone(): string {
  const d = () => Math.floor(Math.random() * 10);
  return `+7 (9${d()}${d()}) ${d()}${d()}${d()}-${d()}${d()}-${d()}${d()}`;
}

// The next incoming call for the student's seat. One call at a time: a new one rings only after the
// previous card is saved and closed.
export async function POST() {
  const user = await op112User();
  if (user instanceof Response) return user;
  const seat = await findActiveSeat(user.id, await currentSessionId());
  if (!seat) return jsonError("no_seat", 409);

  const open = await db.incident.findFirst({ where: { createdBySeatId: seat.id, status: { in: ["draft", "registered"] } } });
  if (open) return jsonError("card_open", 409);
  const ringing = await db.call.findFirst({ where: { seatId: seat.id, kind: "CALLER_IN", status: "RINGING" }, orderBy: { startedAt: "asc" } });
  if (ringing) return Response.json({ call: callDto(ringing) });

  const draw = await drawCall(seat);
  const scenario = draw.scenario;
  if (!scenario) {
    // A repeat call waits for the card of its first call; otherwise every task of the place has rung (op112/seat.ts).
    if (draw.left) return jsonError("waiting", 409);
    await markDealtOut(seat.id, new Date());
    return jsonError(draw.pool ? "all_dealt" : "no_scenarios", 404);
  }
  // One caller per situation in the lesson: the tickets reuse names and numbers (op112/identity.ts). Under a lock, so
  // two places ringing at once do not both keep one ticket's number.
  const call = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lesson-callers:${seat.lessonId}`}))`;
    const written = scenario.caller as CallerPersona;
    const persona = repeatOf(scenario.truth)
      ? written
      : distinctCaller({ ...written, phone: written.phone || randomPhone() }, situationOf(scenario), seat.lessonId, await lessonCallers(tx, seat.lessonId));
    const phone = persona.phone || randomPhone();
    return tx.call.create({
      data: {
        lessonId: seat.lessonId,
        seatId: seat.id,
        kind: "CALLER_IN",
        status: "RINGING",
        counterpart: {
          name: persona.fullName,
          role: persona.role,
          voice: persona.voice ?? "female",
          phone,
          scenarioId: scenario.id,
          persona: { ...persona, phone } as Prisma.InputJsonValue,
        },
      },
    });
  });
  // The last task of the place is ringing: the board shows at once that the place has had them all.
  await markDealtOut(seat.id, draw.left ? null : new Date());
  // Two quick requests may both create a call: keep the oldest ringing one.
  const all = await db.call.findMany({ where: { seatId: seat.id, kind: "CALLER_IN", status: "RINGING" }, orderBy: { startedAt: "asc" } });
  if (all.length > 1) {
    await db.call.deleteMany({ where: { id: { in: all.slice(1).map((c) => c.id) } } });
    return Response.json({ call: callDto(all[0]) });
  }
  return Response.json({ call: callDto(call) });
}

/** Seat.dealtOutAt: when the place ran out of tasks; cleared when something new comes up. */
async function markDealtOut(seatId: string, at: Date | null) {
  await db.seat.updateMany({ where: { id: seatId, dealtOutAt: at ? null : { not: null } }, data: { dealtOutAt: at } });
}
