/**
 * A variant of a ticket with an error in the card («Б4-1-ош», data/scenarios-card-errors.json) is the same call and
 * the same ДДС card as its ticket («Б4-1»): only what the crew finds on arrival differs. For a place the two are one
 * situation — once it has had one of them in a lesson, the other would look like the same card again.
 *
 * Pure: used by the card flow of a ДДС place (flow/dds-flow.ts) and by the calls of a 112 place (op112/seat.ts).
 */

type Ref = { id: string; ticketRef?: string | null };

/** «-ош» marks the variant of a ticket with an error in the card. */
const VARIANT = /-ош$/u;

/** The situation a scenario plays: its ticket without the variant mark; a scenario without a ticket is its own. */
export function situationOf(s: Ref): string {
  return s.ticketRef ? s.ticketRef.replace(VARIANT, "") : `id:${s.id}`;
}

/**
 * The pool without the other half of a pair the place has already had: a scenario is left out when its situation came
 * to the place as another scenario. When that leaves nothing, the pool stays as it is — a repeat is better than an
 * empty feed.
 */
export function withoutPairsOf<T extends Ref>(pool: T[], had: Ref[]): T[] {
  const dealt = new Map<string, Set<string>>();
  for (const h of had) {
    const key = situationOf(h);
    dealt.set(key, (dealt.get(key) ?? new Set<string>()).add(h.id));
  }
  if (!dealt.size) return pool;
  const rest = pool.filter((s) => {
    const ids = dealt.get(situationOf(s));
    return !ids || ids.has(s.id);
  });
  return rest.length ? rest : pool;
}

/** The ids with the other half of their pairs among `scenarios` added: busy with a ticket means busy with its variant. */
export function withPairs(ids: Set<string>, scenarios: Ref[]): Set<string> {
  const keys = new Set(scenarios.filter((s) => ids.has(s.id)).map(situationOf));
  if (!keys.size) return ids;
  return new Set([...ids, ...scenarios.filter((s) => keys.has(situationOf(s))).map((s) => s.id)]);
}
