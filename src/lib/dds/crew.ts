/**
 * The crew's life on a card, derived from facts already in the database — no extra tables:
 *
 *   dispatch = the first own status with a crew number (Принята + «Номер наряда»), or the moment the
 *              dispatcher sent a free crew by phone, whichever is earlier;
 *   stages   = the scenario's expected chain (Начало реагирования → Прибытие → … → Работы завершены),
 *              spread over CREW_PACE_SEC from the dispatch.
 *
 * The crew reports every stage it reaches by phone; the dispatcher sets the matching status by the report — there is
 * no time norm for it (customer's answer of 27.09: only 30 s to open the card and 3 min to the first record).
 */
import type { ServiceStatus } from "@prisma/client";
import { crewChain, type CrewPlan, type DdsReferenceEntry } from "./scenario";

/**
 * The crew's own pace in the simulation: stages spread over this many seconds after the dispatch. Not a
 * norm of the dispatcher — statuses have no time norms (customer's answer of 27.09), the pace only makes
 * the reports come within a lesson.
 */
export const CREW_PACE_SEC = 180;

/** Share of the crew's pace after the dispatch when the crew reaches a stage. */
export const STAGE_SHARE: Partial<Record<ServiceStatus, number>> = {
  STARTED: 0.15,
  ARRIVED: 0.45,
  WORKING: 0.65,
  FINISHED: 1,
  REFUSED: 1,
};

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
  if (ref?.decision === "open") {
    // Nobody asked for a crew; one sent anyway comes back with nothing to do.
    return {
      chain: ["STARTED", "ARRIVED", "FINISHED"],
      plan: { ...ref.crew, result: ref.crew.result ?? "на месте работают профильные службы, наша помощь не потребовалась" },
    };
  }
  return { chain: crewChain(ref), plan: ref?.crew ?? {} };
}
