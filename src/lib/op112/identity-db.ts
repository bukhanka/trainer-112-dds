/** The callers already in a lesson: of the calls at its 112 places and of the cards dealt to its ДДС places. */
import type { Prisma } from "@prisma/client";
import type { IncidentCaller } from "@/lib/incident/types";
import { situationOf } from "@/lib/scenarios/pairs";
import type { TakenCaller } from "./identity";

type Db = Prisma.TransactionClient;

export async function lessonCallers(tx: Db, lessonId: string): Promise<TakenCaller[]> {
  const [calls, cards] = await Promise.all([
    tx.call.findMany({ where: { lessonId, kind: "CALLER_IN" }, select: { id: true, counterpart: true } }),
    tx.incident.findMany({ where: { lessonId, source: "generated" }, select: { id: true, caller: true, scenarioId: true } }),
  ]);
  const cp = (c: { counterpart: unknown }) => (c.counterpart ?? {}) as { scenarioId?: string; name?: string; phone?: string; persona?: { fullName?: string } };
  const ids = [...new Set([...calls.map((c) => cp(c).scenarioId), ...cards.map((c) => c.scenarioId)].filter((id): id is string => Boolean(id)))];
  const scenarios = ids.length ? await tx.scenario.findMany({ where: { id: { in: ids } }, select: { id: true, ticketRef: true } }) : [];
  const situation = new Map(scenarios.map((s) => [s.id, situationOf(s)]));
  return [
    ...calls.map((c) => ({
      situation: situation.get(cp(c).scenarioId ?? "") ?? `call:${c.id}`,
      fullName: cp(c).persona?.fullName ?? cp(c).name,
      phone: cp(c).phone,
    })),
    ...cards.map((c) => {
      const caller = (c.caller ?? {}) as IncidentCaller;
      return { situation: situation.get(c.scenarioId ?? "") ?? `card:${c.id}`, fullName: caller.fullName, phone: caller.aon ?? caller.provided };
    }),
  ];
}
