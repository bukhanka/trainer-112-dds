/**
 * Situations at the other role's places of a lesson.
 *
 * In play right now (a preference): a ДДС place that draws cards by itself does not get the ticket a 112 place of the
 * same lesson is talking through, and a 112 place does not ring with a situation open in a ДДС feed — the class would
 * see one situation at two places at once. When nothing else is left, the busy scenario is dealt anyway.
 *
 * Taken by the other role (a rule, in a lesson of mixed cards): a card typed at a 112 place reaches the ДДС places of
 * its services, so a ДДС place never gets a generated card of a situation that is ringing at a 112 place, has been
 * typed there or is a task of a 112 place — it would get the same situation twice. A 112 place drawing by itself does
 * not ring with a situation a ДДС place of the lesson has already got as a generated card.
 */
import type { Prisma } from "@prisma/client";
import { DONE_STATUSES } from "@/lib/dds/scope";

type Reader = { incident: Pick<Prisma.TransactionClient["incident"], "findMany">; call: Pick<Prisma.TransactionClient["call"], "findMany"> };

/** The scenario a caller's call plays (Call.counterpart.scenarioId). */
export const scenarioOfCall = (c: { counterpart: Prisma.JsonValue }) => {
  const id = c.counterpart && typeof c.counterpart === "object" ? (c.counterpart as { scenarioId?: unknown }).scenarioId : null;
  return typeof id === "string" ? id : null;
};

/** Ringing or answered calls and cards not closed yet at the 112 places of the lesson. */
export async function inPlayAt112(db: Reader, lessonId: string): Promise<Set<string>> {
  const [cards, calls] = await Promise.all([
    db.incident.findMany({
      where: { lessonId, source: "op112", status: { in: ["draft", "registered"] }, scenarioId: { not: null } },
      select: { scenarioId: true },
    }),
    db.call.findMany({ where: { lessonId, kind: "CALLER_IN", status: { in: ["RINGING", "ACTIVE"] } }, select: { counterpart: true } }),
  ]);
  const ids = new Set<string>();
  for (const c of cards) if (c.scenarioId) ids.add(c.scenarioId);
  for (const c of calls) {
    const id = scenarioOfCall(c);
    if (id) ids.add(id);
  }
  return ids;
}

/**
 * Situations of the 112 places of a lesson: their tasks, the calls ringing, in talk or on hold, the cards typed there
 * (any status). In a lesson of mixed cards they reach the ДДС places from the 112 places, not from the card flow.
 */
export async function takenAt112(db: Reader & { seat: Pick<Prisma.TransactionClient["seat"], "findMany"> }, lessonId: string): Promise<Set<string>> {
  const [seats, cards, calls] = await Promise.all([
    db.seat.findMany({ where: { lessonId, role: "OP112" }, select: { scenarioIds: true } }),
    db.incident.findMany({ where: { lessonId, source: "op112", scenarioId: { not: null } }, select: { scenarioId: true } }),
    db.call.findMany({ where: { lessonId, kind: "CALLER_IN", status: { in: ["RINGING", "ACTIVE", "HELD"] } }, select: { counterpart: true } }),
  ]);
  const ids = new Set<string>(seats.flatMap((s) => s.scenarioIds));
  for (const c of cards) if (c.scenarioId) ids.add(c.scenarioId);
  for (const c of calls) {
    const id = scenarioOfCall(c);
    if (id) ids.add(id);
  }
  return ids;
}

/** Cards generated for the ДДС places of the lesson that still have a plate in work. */
export async function inPlayAtDds(db: Pick<Reader, "incident">, lessonId: string): Promise<Set<string>> {
  const cards = await db.incident.findMany({
    where: { lessonId, ddsSeatId: { not: null }, scenarioId: { not: null }, services: { some: { status: { notIn: [...DONE_STATUSES] } } } },
    select: { scenarioId: true },
  });
  return new Set(cards.flatMap((c) => (c.scenarioId ? [c.scenarioId] : [])));
}

/** Every situation generated for a ДДС place of the lesson, closed or not. */
export async function dealtAtDds(db: Pick<Reader, "incident">, lessonId: string): Promise<Set<string>> {
  const cards = await db.incident.findMany({ where: { lessonId, ddsSeatId: { not: null }, scenarioId: { not: null } }, select: { scenarioId: true } });
  return new Set(cards.flatMap((c) => (c.scenarioId ? [c.scenarioId] : [])));
}

/** The pool without the busy scenarios, unless that leaves nothing. */
export function preferNotInPlay<T extends { id: string }>(pool: T[], busy: Set<string>): T[] {
  if (!busy.size) return pool;
  const free = pool.filter((s) => !busy.has(s.id));
  return free.length ? free : pool;
}
