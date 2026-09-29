/**
 * Other services on the same card move by themselves, so the card looks alive: VIS services get
 * «Получена службой» from their server within seconds, others when «their» dispatcher opens it;
 * then Принята with a crew number, the trip and the end of works. Services notified by phone only
 * (grey plates) never get statuses. The plan is deterministic per plate, so every poll agrees. The closing line
 * follows the scenario: the service's own report from the reference when there is one, and never «пострадавших нет»
 * on a card with someone hurt on site.
 */
import type { ServiceDelivery, ServiceStatus } from "@prisma/client";

export type BotStep = { status: ServiceStatus; afterSec: number; comment?: string; crewNumber?: string };

export type BotPlate = {
  id: string;
  serviceId: number;
  shortName: string;
  delivery: ServiceDelivery;
  /** What this service reported at the end of its work in the scenario's reference (dds/scenario.ts serviceReport). */
  report?: string | null;
  /** Someone is hurt on site: the card says so, or the crews find it there (an error in the card). */
  victims?: boolean;
};

/** Small stable hash, enough to spread timings. */
export function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const VIS = /^Служба 10[1-4]$|^ЦОДД$/;

export function isVisService(shortName: string): boolean {
  return VIS.test(shortName);
}

/** «оп. 9999» for external systems, a three-digit operator for services working on the workstation. */
export function botActor(plate: Pick<BotPlate, "id" | "shortName">): string {
  return isVisService(plate.shortName) ? "оп. 9999" : `оп. ${100 + (hash(plate.id) % 900)}`;
}

type Lines = { accept: string; start: string; arrive: string; work: string; finish: string; crew: string };

function linesFor(shortName: string, seed: number, victims: boolean): Lines {
  if (shortName === "Служба 101") {
    return {
      accept: "Принято, высылаем ПСЧ",
      start: "Выезд ПСЧ",
      arrive: "Прибытие ПСЧ, ведётся разведка",
      work: "Ведутся работы по тушению",
      // Never «пострадавших нет» on a card with someone hurt on site.
      finish: victims ? "Работы на месте завершены, пострадавший передан бригаде скорой помощи" : "Работы на месте завершены, пострадавших нет",
      crew: `ПСЧ-${10 + (seed % 80)}`,
    };
  }
  if (shortName === "Служба 102") {
    return {
      accept: "Принято, направлен наряд ППС",
      start: "Наряд выехал",
      arrive: "Наряд на месте",
      work: "Опрос очевидцев",
      finish: "Работы завершены, материал зарегистрирован в КУСП",
      crew: `${200 + (seed % 700)}`,
    };
  }
  if (shortName === "Служба 103") {
    return {
      accept: "Принято, бригада СМП направлена",
      start: "Бригада выехала",
      arrive: "Бригада на месте",
      work: "Осмотр пострадавших",
      finish: "Помощь оказана на месте, госпитализация не потребовалась",
      crew: `${100 + (seed % 800)}`,
    };
  }
  if (shortName === "Служба 104") {
    return {
      accept: "Принято, выезд аварийной бригады",
      start: "Бригада выехала",
      arrive: "Бригада прибыла на адрес",
      work: "Проверка загазованности",
      finish: "Загазованность не обнаружена, газ подан",
      crew: `АГБ-${1 + (seed % 40)}`,
    };
  }
  return {
    accept: "Принято в работу",
    start: "Выезд дежурного",
    arrive: "Прибытие на место",
    work: "Работы ведутся",
    finish: "Работы завершены",
    crew: `${1 + (seed % 60)}`,
  };
}

export function botPlan(plate: BotPlate): BotStep[] {
  if (plate.delivery === "PHONE") return [];
  const seed = hash(plate.id);
  const r = (min: number, max: number, salt: number) => min + (hash(`${plate.id}:${salt}`) % (max - min + 1));
  const lines = linesFor(plate.shortName, seed, plate.victims === true);

  const received = isVisService(plate.shortName) ? r(2, 8, 1) : r(6, 20, 1);
  const accepted = received + r(4, 14, 2);
  const started = accepted + r(30, 70, 3);
  const arrived = started + r(50, 110, 4);
  const working = arrived + r(20, 50, 5);
  const finished = working + r(90, 200, 6);

  const steps: BotStep[] = [
    { status: "RECEIVED", afterSec: received },
    { status: "ACCEPTED", afterSec: accepted, comment: lines.accept, crewNumber: lines.crew },
    { status: "STARTED", afterSec: started, comment: lines.start },
    { status: "ARRIVED", afterSec: arrived, comment: lines.arrive },
  ];
  // Some services skip «Проведение работ», as the memo allows.
  if (seed % 3 !== 0) steps.push({ status: "WORKING", afterSec: working, comment: lines.work });
  // The service's own report of the scenario, when the reference has one: the card's outcome as the scenario tells it.
  steps.push({ status: "FINISHED", afterSec: finished, comment: plate.report?.trim() || lines.finish });
  return steps;
}

/** Steps that are due by `elapsedSec` and come after the plate's current status. */
export function dueSteps(plan: BotStep[], current: ServiceStatus, elapsedSec: number): BotStep[] {
  const done = plan.findIndex((s) => s.status === current);
  if (done < 0 && current !== "ADDED") return []; // someone else moved this plate; leave it alone
  return plan.slice(done + 1).filter((s) => s.afterSec <= elapsedSec);
}
