/**
 * Situations in play at the other role's places of a lesson right now.
 *
 * A ДДС place that draws cards by itself must not get the ticket a 112 place of the same lesson is
 * talking through: the 112 card, once saved, comes to the ДДС feed as well, and the same situation
 * shows twice. The same holds the other way: a 112 place does not ring with a situation that is
 * open in a ДДС feed of the lesson. It is only a preference — when nothing else is left, the busy
 * scenario is dealt anyway.
 */
import type { Prisma } from "@prisma/client";
import { DONE_STATUSES } from "@/lib/dds/scope";

type Reader = { incident: Pick<Prisma.TransactionClient["incident"], "findMany">; call: Pick<Prisma.TransactionClient["call"], "findMany"> };

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
    const id = c.counterpart && typeof c.counterpart === "object" ? (c.counterpart as { scenarioId?: unknown }).scenarioId : null;
    if (typeof id === "string") ids.add(id);
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

/** The pool without the busy scenarios, unless that leaves nothing. */
/**
 * Never the same situation twice in a row at a place while there is another: the first of the choices
 * (from the most wanted to the widest) that offers something other than the last scenario.
 */
export function notRightAfter<T extends { id: string }>(choices: T[][], lastId: string | null | undefined): T[] {
  if (lastId) {
    for (const choice of choices) {
      const other = choice.filter((s) => s.id !== lastId);
      if (other.length) return other;
    }
  }
  return choices[0];
}

/** The scenario of the latest card of a place. */
export function latestScenario(cards: { scenarioId: string | null; createdAt: Date }[]): string | null {
  let last: { scenarioId: string | null; createdAt: Date } | null = null;
  for (const c of cards) if (c.scenarioId && (!last || c.createdAt > last.createdAt)) last = c;
  return last?.scenarioId ?? null;
}

export function preferNotInPlay<T extends { id: string }>(pool: T[], busy: Set<string>): T[] {
  if (!busy.size) return pool;
  const free = pool.filter((s) => !busy.has(s.id));
  return free.length ? free : pool;
}
