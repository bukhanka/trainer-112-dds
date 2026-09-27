/** Server side of the calls from the work-off row: who answers and what the duty knows about the card. */
import type { Call, Incident, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { servicePhone } from "@/lib/dds/personas";
import type { IncidentAddress } from "@/lib/incident/types";
import { tagsToAnswers } from "./card";
import { dutyGreeting, dutyOf, dutyTitle, type DutyContext } from "./duty";
import { typeNames } from "./panels";
import { serviceCatalog } from "./services";
import type { CallLine } from "./types";

type ServiceCounterpart = { kind: "service"; serviceId: number; service: string; fullName: string | null; duty: string; voice: "male" | "female"; phone: string };

export function serviceCounterpart(call: Pick<Call, "counterpart">): ServiceCounterpart | null {
  const cp = (call.counterpart ?? {}) as Partial<ServiceCounterpart>;
  return typeof cp.serviceId === "number" && cp.duty ? (cp as ServiceCounterpart) : null;
}

/** What the duty of `serviceId` checks the operator's words against. */
export async function dutyContextOf(incident: Pick<Incident, "number" | "address" | "tags" | "typeCodes">, cp: ServiceCounterpart): Promise<DutyContext> {
  const address = (incident.address ?? {}) as IncidentAddress;
  const { cards } = tagsToAnswers(incident.tags);
  const names = await typeNames(incident.typeCodes);
  return {
    service: cp.service,
    serviceFull: cp.fullName,
    duty: cp.duty,
    cardNumber: incident.number,
    street: address.street,
    house: address.house,
    descriptive: address.descriptive,
    what: [...cards, ...Object.values(names)],
  };
}

/**
 * Dial a service from the work-off row: the duty answers at once with his name. One line at a time — a call
 * still going on this card is hung up first.
 */
export async function dialService(
  incident: Pick<Incident, "id" | "number" | "lessonId" | "address" | "tags" | "typeCodes">,
  seatId: string,
  serviceId: number,
): Promise<Call | null> {
  const service = (await serviceCatalog()).find((s) => s.id === serviceId);
  if (!service) return null;
  const { duty, voice } = dutyOf(serviceId, incident.number);
  const cp: ServiceCounterpart = {
    kind: "service",
    serviceId,
    service: service.shortName,
    fullName: service.fullName ?? null,
    duty,
    voice,
    phone: servicePhone({ id: service.id, shortName: service.shortName }),
  };
  const now = new Date();
  const greeting: CallLine = { role: "counterpart", text: dutyGreeting(await dutyContextOf(incident, cp)), at: now.toISOString(), revealed: [] };
  return db.$transaction(async (tx) => {
    await tx.call.updateMany({ where: { incidentId: incident.id, kind: "SERVICE_OUT", status: "ACTIVE" }, data: { status: "ENDED", endedAt: now } });
    return tx.call.create({
      data: {
        lessonId: incident.lessonId,
        seatId,
        incidentId: incident.id,
        kind: "SERVICE_OUT",
        status: "ACTIVE",
        answeredAt: now,
        counterpart: { ...cp, name: `${service.shortName}, ${dutyTitle(duty)}` } as unknown as Prisma.InputJsonValue,
        messages: [greeting] as unknown as Prisma.InputJsonValue,
      },
    });
  });
}
