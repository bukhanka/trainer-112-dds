/**
 * The crew's life on a card, derived from facts already in the database — no extra tables:
 *
 *   dispatch = the first own status with a crew number (Принята + «Номер наряда»), or the moment the
 *              dispatcher sent a free crew by phone, whichever is earlier;
 *   stages   = the scenario's expected chain (Начало реагирования → Прибытие → … → Работы завершены),
 *              spread over the lesson's workSec from the dispatch.
 *
 * The crew reports every stage it reaches by phone; the dispatcher is expected to set the matching
 * status soon after the report.
 */
import type { ServiceStatus } from "@prisma/client";
import { crewChain, type CrewPlan, type DdsReferenceEntry } from "./scenario";

/** Share of workSec after the dispatch when the crew reaches a stage. */
export const STAGE_SHARE: Partial<Record<ServiceStatus, number>> = {
  STARTED: 0.15,
  ARRIVED: 0.45,
  WORKING: 0.65,
  FINISHED: 1,
  REFUSED: 1,
};

/** A status set later than this after the crew's report counts as late. */
export const REPORT_REACT_SEC = 60;

export type CrewStep = { status: ServiceStatus; afterSec: number };

export function crewSchedule(chain: ServiceStatus[], workSec: number): CrewStep[] {
  return chain.filter((s) => STAGE_SHARE[s] != null).map((s) => ({ status: s, afterSec: Math.round(STAGE_SHARE[s]! * workSec) }));
}

/** The last stage reached `elapsedSec` after the dispatch; null while the crew is getting ready. */
export function stageAt(schedule: CrewStep[], elapsedSec: number): ServiceStatus | null {
  let reached: ServiceStatus | null = null;
  for (const step of schedule) if (step.afterSec <= elapsedSec) reached = step.status;
  return reached;
}

export type Dispatch = { crew: string; at: Date; via: "status" | "phone" };

const WORKING_STATES: ServiceStatus[] = ["ACCEPTED", "STARTED", "ARRIVED", "WORKING"];

export function dispatchOf(
  events: { status: ServiceStatus; crewNumber: string | null; at: Date }[],
  phone: { crew: string; at: Date }[] = [],
): Dispatch | null {
  const byStatus = [...events]
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .find((e) => e.crewNumber && WORKING_STATES.includes(e.status));
  const byPhone = [...phone].sort((a, b) => a.at.getTime() - b.at.getTime())[0];
  const candidates: Dispatch[] = [];
  if (byStatus) candidates.push({ crew: byStatus.crewNumber!, at: byStatus.at, via: "status" });
  if (byPhone) candidates.push({ crew: byPhone.crew, at: byPhone.at, via: "phone" });
  return candidates.sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;
}

/**
 * What the crew does on this card. When the reference says the service should not react, a crew sent
 * anyway finds out on site and refuses — the trainee then has to close with «Отказ» and a reason.
 */
export function crewPlanFor(ref: DdsReferenceEntry | null): { chain: ServiceStatus[]; plan: CrewPlan } {
  if (ref?.decision === "reject") {
    return {
      chain: ["STARTED", "ARRIVED", "REFUSED"],
      plan: { ...ref.crew, refuse: ref.crew.refuse ?? "это не наша зона ответственности, пусть диспетчер передаст информацию по принадлежности" },
    };
  }
  return { chain: crewChain(ref), plan: ref?.crew ?? {} };
}
