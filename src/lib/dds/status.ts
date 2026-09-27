/**
 * Response statuses of one service plate on a card, as the dispatcher memo describes them.
 *
 *   Добавлена / Получена службой  — technical, set by the system (card saved / card opened);
 *   Принята | Не принята          — the first answer of the service;
 *   Не принята → only Принята      — the dispatcher changed their mind;
 *   Принята → progress statuses    — Начало реагирования, Прибытие, Проведение работ (steps may be skipped),
 *                                    then Работы завершены or Отказ от выполнения работ, which close the card
 *                                    for this service. There is no way back.
 *
 * Служба 103 never sets «Не принята» or «Отказ»: it closes with «Работы завершены» and the comment
 * «Завершение работ без бригады» instead.
 *
 * Time norms, by the customer's answer of 27.09: 30 s (ackSec) from «Добавлена» to opening the card, and
 * 3 min (workSec) from «Добавлена» to the first record — a status with a text. Statuses have no other norms:
 * the works may take hours.
 */
import type { ServiceStatus } from "@prisma/client";

export const STATUS_LABEL: Record<ServiceStatus, string> = {
  ADDED: "Добавлена",
  RECEIVED: "Получена службой",
  ACCEPTED: "Принята",
  REJECTED: "Не принята",
  STARTED: "Начало реагирования",
  ARRIVED: "Прибытие",
  WORKING: "Проведение работ",
  FINISHED: "Работы завершены",
  REFUSED: "Отказ от выполнения работ",
};

export const ALL_STATUSES = Object.keys(STATUS_LABEL) as ServiceStatus[];

/** Set by the system, never by the dispatcher. */
export const TECHNICAL: readonly ServiceStatus[] = ["ADDED", "RECEIVED"];
/** Progress of the crew, in the order they happen. */
export const PROGRESS: readonly ServiceStatus[] = ["STARTED", "ARRIVED", "WORKING"];
/** Close the card for the service. */
export const CLOSING: readonly ServiceStatus[] = ["FINISHED", "REFUSED"];

export const NO_CREW_COMMENT = "Завершение работ без бригады";

export type ServiceRules = {
  /** Служба 103: no «Не принята» and no «Отказ от выполнения работ». */
  noReject: boolean;
};

export function rulesFor(service: { shortName: string } | null | undefined): ServiceRules {
  return { noReject: !!service && /(^|\D)103(\D|$)/.test(service.shortName) };
}

export function isClosed(status: ServiceStatus): boolean {
  return CLOSING.includes(status);
}

/** The service has not given its first answer yet. */
export function awaitsAnswer(status: ServiceStatus): boolean {
  return TECHNICAL.includes(status);
}

/** Statuses the dispatcher may pick next, in the order of the drop-down list. */
export function allowedNext(current: ServiceStatus, rules: ServiceRules): ServiceStatus[] {
  switch (current) {
    case "ADDED":
    case "RECEIVED":
      return rules.noReject ? ["ACCEPTED", "FINISHED"] : ["ACCEPTED", "REJECTED"];
    case "REJECTED":
      return ["ACCEPTED"];
    case "ACCEPTED":
    case "STARTED":
    case "ARRIVED":
    case "WORKING": {
      const done = current === "ACCEPTED" ? -1 : PROGRESS.indexOf(current);
      const ahead = PROGRESS.slice(done + 1);
      return rules.noReject ? [...ahead, "FINISHED"] : [...ahead, "REFUSED", "FINISHED"];
    }
    case "FINISHED":
    case "REFUSED":
      return [];
  }
}

export function commentRequired(next: ServiceStatus): boolean {
  return next === "REJECTED" || next === "REFUSED" || next === "FINISHED";
}

/** 103 closes straight from the first answer: that is its way to say «без бригады». */
export function isNoCrewClosing(current: ServiceStatus, next: ServiceStatus, rules: ServiceRules): boolean {
  return rules.noReject && next === "FINISHED" && awaitsAnswer(current);
}

/** The event that is the service's first answer: Принята / Не принята, or 103 closing without a crew. */
export function isFirstAnswer(current: ServiceStatus, next: ServiceStatus): boolean {
  return awaitsAnswer(current) && !awaitsAnswer(next);
}

export const COMMENT_MAX = 1000;
export const CREW_MAX = 30;

export type TransitionInput = {
  current: ServiceStatus;
  next: ServiceStatus;
  comment?: string | null;
  crewNumber?: string | null;
  /** Crew number already on the plate: it stays unless the dispatcher types another one. */
  currentCrew?: string | null;
  rules: ServiceRules;
};

export type TransitionResult =
  | { ok: true; comment: string | null; crewNumber: string | null }
  | { ok: false; error: string };

const listLabels = (list: ServiceStatus[]) => list.map((s) => `«${STATUS_LABEL[s]}»`).join(", ");

export function checkTransition(input: TransitionInput): TransitionResult {
  const { current, next, rules } = input;
  if (isClosed(current)) {
    return {
      ok: false,
      error: `После «${STATUS_LABEL[current]}» карточка закрыта для вашей службы. Ошибку исправляет отдел контроля — сообщите по телефону.`,
    };
  }
  const allowed = allowedNext(current, rules);
  if (!allowed.includes(next)) {
    return { ok: false, error: `После «${STATUS_LABEL[current]}» можно поставить только ${listLabels(allowed)}.` };
  }

  const comment = (input.comment ?? "").trim().replace(/\s+/g, " ");
  if (comment.length > COMMENT_MAX) return { ok: false, error: `Комментарий длиннее ${COMMENT_MAX} символов.` };
  if (commentRequired(next) && !comment) {
    if (next === "REJECTED") return { ok: false, error: "Для «Не принята» нужен комментарий: причина и кому передана информация." };
    if (next === "REFUSED") {
      return { ok: false, error: "Для «Отказ от выполнения работ» нужен комментарий: причина и кому передана информация." };
    }
    if (isNoCrewClosing(current, next, rules)) {
      return { ok: false, error: `Служба 103 вместо «Не принята» ставит «Работы завершены» с комментарием «${NO_CREW_COMMENT}».` };
    }
    return { ok: false, error: "Перед «Работы завершены» запишите итоги в комментарий: после сохранения карточка закроется." };
  }
  if (isNoCrewClosing(current, next, rules) && !/без\s+бригады/i.test(comment)) {
    return { ok: false, error: `Служба 103 вместо «Не принята» ставит «Работы завершены» с комментарием «${NO_CREW_COMMENT}».` };
  }

  const crew = (input.crewNumber ?? "").trim() || (input.currentCrew ?? "").trim();
  if (crew.length > CREW_MAX) return { ok: false, error: `Номер наряда длиннее ${CREW_MAX} символов.` };

  return { ok: true, comment: comment || null, crewNumber: crew || null };
}

/** Later than `normSec` after «Добавлена». */
export function isLate(addedAt: Date, at: Date, normSec: number): boolean {
  return at.getTime() - addedAt.getTime() > normSec * 1000;
}

/** A record of the service (the 3-minute norm): a status the dispatcher set with a text. A bare status is not one. */
export function isRecord(e: { status: ServiceStatus; comment: string | null }): boolean {
  return !TECHNICAL.includes(e.status) && !!e.comment?.trim();
}

/** When the card was opened (the 30-second norm) and when its first record was made (the 3-minute norm). */
export function normMoments(events: { status: ServiceStatus; comment: string | null; at: Date }[]): { openedAt: Date | null; recordAt: Date | null } {
  return {
    openedAt: events.find((e) => e.status !== "ADDED")?.at ?? null,
    recordAt: events.find(isRecord)?.at ?? null,
  };
}
