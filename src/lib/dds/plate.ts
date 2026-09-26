/**
 * The dispatcher's own plate: «Получена службой» when the card is opened, and status changes from
 * the status line (Статус | Номер наряда | Комментарий), checked by the status machine.
 */
import type { ServiceStatus } from "@prisma/client";
import type { SessionUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import { seatFeedWhere, settingsOf, SYSTEM_ACTOR } from "@/lib/flow/dds-flow";
import { shortName } from "./format";
import { evaluatePlate } from "./review";
import type { DdsSeat } from "./seat";
import { checkTransition, isFirstAnswer, isLate, rulesFor } from "./status";

/** Card of the place by its number, or null when the card is not in this place's feed. */
export async function findSeatIncident(seat: DdsSeat, number: number) {
  if (!Number.isInteger(number)) return null;
  return db.incident.findFirst({ where: { AND: [{ number }, seatFeedWhere(seat)] }, select: { id: true } });
}

/** «Получена службой»: set by the system the first time the dispatcher opens the card. */
export async function markReceived(seat: DdsSeat, incidentId: string, now = new Date()): Promise<void> {
  if (!seat.serviceId) return;
  const plate = await db.incidentService.findUnique({
    where: { incidentId_serviceId: { incidentId, serviceId: seat.serviceId } },
    select: { id: true, status: true },
  });
  if (!plate || plate.status !== "ADDED") return;
  const moved = await db.incidentService.updateMany({ where: { id: plate.id, status: "ADDED" }, data: { status: "RECEIVED" } });
  if (moved.count) {
    await db.statusEvent.create({
      data: { incidentServiceId: plate.id, status: "RECEIVED", actorLabel: SYSTEM_ACTOR, seatId: seat.id, at: now },
    });
  }
}

export type StatusInput = { status: ServiceStatus; crewNumber?: string | null; comment?: string | null };
export type StatusResult = { ok: true; plateId: string; status: ServiceStatus; late: boolean } | { ok: false; error: string; code: number };

export async function setOwnStatus(
  user: SessionUser,
  seat: DdsSeat,
  incidentId: string,
  input: StatusInput,
  now = new Date(),
): Promise<StatusResult> {
  if (!seat.serviceId || !seat.service) return { ok: false, error: "У места не выбрана служба", code: 409 };
  const plate = await db.incidentService.findUnique({
    where: { incidentId_serviceId: { incidentId, serviceId: seat.serviceId } },
  });
  if (!plate) return { ok: false, error: "Вашей службы нет на этой карточке", code: 404 };

  const check = checkTransition({
    current: plate.status,
    next: input.status,
    comment: input.comment,
    crewNumber: input.crewNumber,
    currentCrew: plate.crewNumber,
    rules: rulesFor(seat.service),
  });
  if (!check.ok) return { ok: false, error: check.error, code: 422 };

  const settings = settingsOf(seat.lesson.settings);
  const late = isFirstAnswer(plate.status, input.status) && isLate(plate.addedAt, now, settings.ackSec);

  const saved = await db.$transaction(async (tx) => {
    // Optimistic step: a double click or a second tab must not write the same status twice.
    const moved = await tx.incidentService.updateMany({
      where: { id: plate.id, status: plate.status },
      data: { status: input.status, crewNumber: check.crewNumber },
    });
    if (!moved.count) return false;
    await tx.statusEvent.create({
      data: {
        incidentServiceId: plate.id,
        status: input.status,
        comment: check.comment,
        crewNumber: check.crewNumber,
        actorLabel: shortName(user.fullName),
        actorUserId: user.id,
        seatId: seat.id,
        late,
        at: now,
      },
    });
    return true;
  });
  if (!saved) return { ok: false, error: "Статус уже изменился — карточка обновлена, проверьте и повторите", code: 409 };

  await audit({
    action: "dds.status",
    actorId: user.id,
    actor: user.login,
    entity: "IncidentService",
    entityId: plate.id,
    before: { status: plate.status, crewNumber: plate.crewNumber },
    after: { status: input.status, crewNumber: check.crewNumber, comment: check.comment, late },
  });
  // Review on a final answer; a plate reviewed before (Не принята → Принята) is reviewed again.
  const reviewed = await db.attempt.count({ where: { incidentServiceId: plate.id, kind: "DDS" } });
  if (["REJECTED", "FINISHED", "REFUSED"].includes(input.status) || reviewed) {
    try {
      await evaluatePlate(plate.id, now);
    } catch (err) {
      console.error("dds review failed", plate.id, err);
    }
  }
  return { ok: true, plateId: plate.id, status: input.status, late };
}
