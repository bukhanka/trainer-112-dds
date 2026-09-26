/** Everything the 112 workstation needs in one request: place, current call, open card, journal. */
import type { Call, Incident, IncidentService, Service } from "@prisma/client";
import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/session";
import { kindTitle } from "./catalog";
import { tagsToAnswers } from "./card";
import { draftFromIncident } from "./draft";
import { addressLine } from "./gazetteer";
import { findActiveSeat, hasDdsSeat, isSelfTraining, lessonSettings, operatorNumber, type Op112Seat } from "./seat";
import type { CallLine, Op112CardDraft } from "./types";

export type PlateDto = {
  serviceId: number;
  shortName: string;
  fullName: string | null;
  isMain: boolean;
  auto: boolean;
  status: string;
  addedAt: string;
};

export type CallDto = {
  id: string;
  status: Call["status"];
  phone: string;
  voice: "male" | "female";
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  messages: CallLine[];
};

export type IncidentDto = {
  id: string;
  number: number;
  status: string;
  openedAt: string | null;
  savedAt: string | null;
  workedAt: string | null;
  updatedLabel: string | null;
  important: boolean;
  draft: Op112CardDraft;
  plates: PlateDto[];
};

export type JournalRow = {
  id: string;
  number: number;
  openedAt: string | null;
  savedAt: string | null;
  status: string;
  chips: string;
  address: string;
  score: number | null;
  typingSec: number | null;
};

export type Op112State = {
  serverNow: string;
  user: { fullName: string; operatorNo: string };
  seat: { id: string; label: string | null; armNo: string } | null;
  lesson: { id: string; title: string; selfTraining: boolean; typingSec: number; hints: boolean } | null;
  onDdsSeat: boolean;
  call: CallDto | null;
  incident: IncidentDto | null;
  journal: JournalRow[];
};

export function callDto(call: Call): CallDto {
  const counterpart = (call.counterpart ?? {}) as { phone?: string; voice?: string };
  return {
    id: call.id,
    status: call.status,
    phone: counterpart.phone ?? "",
    voice: counterpart.voice === "male" ? "male" : "female",
    startedAt: call.startedAt.toISOString(),
    answeredAt: call.answeredAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
    messages: (Array.isArray(call.messages) ? call.messages : []) as CallLine[],
  };
}

export function plateDto(row: IncidentService & { service: Service }): PlateDto {
  return {
    serviceId: row.serviceId,
    shortName: row.service.shortName,
    fullName: row.service.fullName,
    isMain: row.isMain,
    auto: row.addedBy !== "manual",
    status: row.status,
    addedAt: row.addedAt.toISOString(),
  };
}

export function incidentDto(
  incident: Incident & { services: (IncidentService & { service: Service })[] },
  updatedLabel?: string | null,
): IncidentDto {
  return {
    id: incident.id,
    number: incident.number,
    status: incident.status,
    openedAt: incident.openedAt?.toISOString() ?? null,
    savedAt: incident.savedAt?.toISOString() ?? null,
    workedAt: incident.workedAt?.toISOString() ?? null,
    updatedLabel: updatedLabel ?? null,
    important: incident.important,
    draft: draftFromIncident(incident),
    // The scenario stays hidden until the review: its title alone would hint at the answer.
    plates: incident.services.map(plateDto).sort((a, b) => Number(b.isMain) - Number(a.isMain)),
  };
}

export function armNumber(seat: Op112Seat): string {
  return seat.label?.match(/\d+/)?.[0] ?? "1";
}

export async function buildState(user: SessionUser): Promise<Op112State> {
  const seat = await findActiveSeat(user.id);
  const base = {
    serverNow: new Date().toISOString(),
    user: { fullName: user.fullName, operatorNo: operatorNumber(user.login) },
  };
  if (!seat) {
    return { ...base, seat: null, lesson: null, onDdsSeat: await hasDdsSeat(user.id), call: null, incident: null, journal: [] };
  }
  const settings = lessonSettings(seat);
  const [incident, journal] = await Promise.all([
    db.incident.findFirst({
      where: { createdBySeatId: seat.id, status: { in: ["draft", "registered"] } },
      orderBy: { createdAt: "desc" },
      include: { services: { include: { service: true }, orderBy: { addedAt: "asc" } } },
    }),
    db.incident.findMany({
      where: { createdBySeatId: seat.id, lessonId: seat.lessonId, status: { in: ["registered", "worked", "empty"] } },
      orderBy: { createdAt: "desc" },
      take: 30,
      include: { attempts: { select: { score: true }, take: 1, orderBy: { createdAt: "desc" } } },
    }),
  ]);
  // The call of the open card, or a new call still ringing.
  const openCall = incident
    ? await db.call.findFirst({ where: { incidentId: incident.id }, orderBy: { startedAt: "desc" } })
    : await db.call.findFirst({ where: { seatId: seat.id, kind: "CALLER_IN", status: "RINGING" }, orderBy: { startedAt: "desc" } });

  return {
    ...base,
    seat: { id: seat.id, label: seat.label, armNo: armNumber(seat) },
    lesson: {
      id: seat.lessonId,
      title: seat.lesson.title,
      selfTraining: isSelfTraining(seat.lesson.settings),
      typingSec: settings.typingSec,
      hints: settings.hints,
    },
    onDdsSeat: false,
    call: openCall ? callDto(openCall) : null,
    incident: incident ? incidentDto(incident) : null,
    journal: journal.map((i) => journalRow(i, i.attempts[0]?.score ?? null)),
  };
}

export function journalRow(i: Incident, score: number | null): JournalRow {
  const { cards } = tagsToAnswers(i.tags);
  const chips = cards.map(kindTitle).join(", ");
  const typing = i.openedAt && i.savedAt ? Math.round((i.savedAt.getTime() - i.openedAt.getTime()) / 1000) : null;
  return {
    id: i.id,
    number: i.number,
    openedAt: i.openedAt?.toISOString() ?? null,
    savedAt: i.savedAt?.toISOString() ?? null,
    status: i.status,
    chips: i.status === "empty" ? "<Нет контакта>" : chips,
    address: addressLine(i.address as never),
    score,
    typingSec: typing,
  };
}
