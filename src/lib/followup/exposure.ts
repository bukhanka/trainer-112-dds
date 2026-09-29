/**
 * Situations a student has already met, at any place and in any role: a call that rang (answered or not), a card
 * typed at a 112 place, a card dealt to a ДДС place, an attempt. A control case must not be one of them.
 */
import type { Prisma } from "@prisma/client";
import { scenarioOfCall } from "@/lib/lessons/in-play";
import { caseKeys } from "./pool";

type Reader = {
  seat: Pick<Prisma.TransactionClient["seat"], "findMany">;
  incident: Pick<Prisma.TransactionClient["incident"], "findMany">;
  call: Pick<Prisma.TransactionClient["call"], "findMany">;
  attempt: Pick<Prisma.TransactionClient["attempt"], "findMany">;
  scenario: Pick<Prisma.TransactionClient["scenario"], "findMany">;
};

/** A caller's case has been exposed even if the operator never saved a card. */
export function caseHeardOnCall(caseIds: string[], calls: { counterpart: Prisma.JsonValue }[]): boolean {
  return calls.some((call) => {
    const id = scenarioOfCall(call);
    return Boolean(id && caseIds.includes(id));
  });
}

/** Situation keys (followup/pool.ts caseKeys) each student has met; `except` — lessons that do not count. */
export async function seenSituations(client: Reader, studentIds: string[], except: string[] = []): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>(studentIds.map((id) => [id, new Set<string>()]));
  if (!studentIds.length) return out;
  const seats = await client.seat.findMany({ where: { studentId: { in: studentIds }, lessonId: { notIn: except } }, select: { id: true, studentId: true } });
  const owner = new Map(seats.map((s) => [s.id, s.studentId]));
  const seatIds = seats.map((s) => s.id);
  const [cards, calls, attempts] = await Promise.all([
    seatIds.length
      ? client.incident.findMany({
          where: { scenarioId: { not: null }, OR: [{ createdBySeatId: { in: seatIds } }, { ddsSeatId: { in: seatIds } }] },
          select: { scenarioId: true, createdBySeatId: true, ddsSeatId: true },
        })
      : Promise.resolve([]),
    seatIds.length ? client.call.findMany({ where: { seatId: { in: seatIds }, kind: "CALLER_IN" }, select: { seatId: true, counterpart: true } }) : Promise.resolve([]),
    client.attempt.findMany({ where: { studentId: { in: studentIds }, scenarioId: { not: null }, lessonId: { notIn: except } }, select: { studentId: true, scenarioId: true } }),
  ]);
  const met: [string, string][] = [];
  for (const c of cards) {
    for (const seat of [c.createdBySeatId, c.ddsSeatId]) {
      const student = seat ? owner.get(seat) : undefined;
      if (student && c.scenarioId) met.push([student, c.scenarioId]);
    }
  }
  for (const c of calls) {
    const student = c.seatId ? owner.get(c.seatId) : undefined;
    const id = scenarioOfCall(c);
    if (student && id) met.push([student, id]);
  }
  for (const a of attempts) if (a.scenarioId) met.push([a.studentId, a.scenarioId]);
  if (!met.length) return out;
  const scenarios = await client.scenario.findMany({ where: { id: { in: [...new Set(met.map(([, id]) => id))] } }, select: { id: true, ticketRef: true, learningMeta: true } });
  const keys = new Map(scenarios.map((s) => [s.id, caseKeys(s)]));
  for (const [student, id] of met) for (const key of keys.get(id) ?? []) out.get(student)?.add(key);
  return out;
}
