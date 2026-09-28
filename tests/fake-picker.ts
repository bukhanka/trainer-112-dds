/**
 * Stand-ins for the database in the tests of what a place gets next (flow/dds-flow.ts drawCard, op112/seat.ts drawCall).
 * They answer the few queries those functions make by the shape of `where`, not by a real query engine.
 */
type Row = Record<string, unknown> & { id: string };

/** Tasks marked by hand and the tickets of scenarios a place had are asked by id; the drawing pool by status. */
export const byIds = <T extends { id: string }>(rows: T[], where: { id?: { in?: string[] } }) => (where?.id?.in ? rows.filter((r) => where.id!.in!.includes(r.id)) : rows);

export type DdsWorld = {
  pool: Row[];
  /** The place's own service: null — unknown (the plate preferences step aside). */
  own?: { id: number; shortName: string; okrug?: string | null; district?: string | null } | null;
  /** Cards in the place's feed. */
  feed?: { scenarioId: string; createdAt?: Date; scenario?: { ticketRef: string | null } }[];
  /** Scenarios of cards typed at the lesson's 112 places. */
  typed112?: string[];
  /** Scenarios of calls ringing or in talk at the lesson's 112 places. */
  ringing?: string[];
  /** Tasks of the lesson's 112 places. */
  tasks112?: string[];
  /** Service names by id, for the plate preference. */
  names?: Map<number, string>;
  attempts?: Record<string, unknown>[];
};

/** A transaction for the ДДС picker. */
export function ddsTx(w: DdsWorld) {
  return {
    scenario: { findMany: async ({ where }: { where: { id?: { in?: string[] } } }) => byIds(w.pool, where) },
    service: {
      findUnique: async () => w.own ?? null,
      findMany: async ({ where }: { where: { id?: { in?: number[] } } }) => (where.id?.in ?? []).map((id) => ({ id, shortName: w.names?.get(id) ?? "" })),
    },
    incident: {
      findMany: async ({ where }: { where: { source?: string } }) =>
        where.source === "op112"
          ? (w.typed112 ?? []).map((scenarioId) => ({ scenarioId }))
          : (w.feed ?? []).map((f) => ({ createdAt: new Date(), scenario: { ticketRef: w.pool.find((p) => p.id === f.scenarioId)?.ticketRef ?? null }, ...f })),
    },
    call: { findMany: async () => (w.ringing ?? []).map((scenarioId) => ({ counterpart: { scenarioId, name: "Заявитель" } })) },
    seat: { findMany: async () => (w.tasks112?.length ? [{ scenarioIds: w.tasks112 }] : []) },
    attempt: { findMany: async () => w.attempts ?? [] },
  } as never;
}

export type Op112World = {
  pool: Row[];
  /** Scenarios of cards typed at this place. */
  typed?: string[];
  /** Scenarios of calls that rang at this place, answered or not. */
  rang?: string[];
  /** Scenarios of generated cards at the lesson's ДДС places still open. */
  openInDds?: string[];
  /** Scenarios of every generated card at the lesson's ДДС places. */
  dealtInDds?: string[];
  attempts?: Record<string, unknown>[];
};

/** The db of the 112 picker, to be returned by a vi.mock of @/lib/db. */
export function op112Db(w: () => Op112World) {
  return {
    scenario: { findMany: async ({ where }: { where: { id?: { in?: string[] } } }) => byIds(w().pool, where) },
    incident: {
      findMany: async ({ where }: { where: { createdBySeatId?: string; ddsSeatId?: unknown; services?: unknown; scenario?: unknown } }) => {
        if (where.createdBySeatId) return (w().typed ?? []).map((scenarioId) => ({ scenarioId, createdAt: new Date() }));
        if (where.ddsSeatId) return ((where.services ? w().openInDds : w().dealtInDds) ?? []).map((scenarioId) => ({ scenarioId }));
        return []; // the first cards of repeat calls
      },
    },
    call: { findMany: async () => (w().rang ?? []).map((scenarioId) => ({ counterpart: { scenarioId }, startedAt: new Date() })) },
    attempt: { findMany: async () => w().attempts ?? [] },
  };
}
