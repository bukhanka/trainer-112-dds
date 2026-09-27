/**
 * Server-side views of the ДДС workstation: feed rows and the card, built from the database rows.
 * The browser gets plain JSON with ISO times; formatting happens on the screen (format.ts).
 */
import type { Prisma, ServiceDelivery, ServiceStatus } from "@prisma/client";
import type { DescriptionEntry, IncidentAddress, IncidentCaller, IncidentFlags, TagChoice } from "@/lib/incident/types";
import { db } from "@/lib/db";
import type { CrewTimer } from "./crew";
import { addressFeed, addressTitle, classLine, fmtHM, tagsLine } from "./format";
import { servicePhone } from "./personas";
import { ddsCardOf } from "./scenario";
import { awaitsAnswer, isClosed, STATUS_LABEL } from "./status";

export const incidentInclude = {
  services: {
    include: { service: true, events: { orderBy: { at: "asc" } } },
    orderBy: [{ addedAt: "asc" }, { id: "asc" }],
  },
  scenario: { select: { id: true, title: true, category: true, caller: true, truth: true, ddsCard: true, ddsReference: true } },
} satisfies Prisma.IncidentInclude;

export type IncidentFull = Prisma.IncidentGetPayload<{ include: typeof incidentInclude }>;
type PlateFull = IncidentFull["services"][number];

export type HistoryItem = {
  id: string;
  at: string;
  status: ServiceStatus;
  label: string;
  comment: string | null;
  crewNumber: string | null;
  actor: string;
  late: boolean;
};

export type PlateView = {
  id: string;
  serviceId: number;
  shortName: string;
  fullName: string;
  delivery: ServiceDelivery;
  phone: string;
  own: boolean;
  main: boolean;
  vis: boolean;
  status: ServiceStatus;
  label: string;
  crewNumber: string | null;
  addedAt: string;
  lastAt: string;
  lastLate: boolean;
  history: HistoryItem[];
};

export type TypeInfo = { cardType: string; finalTypes: string[] };

const MAIN_TO_CARD: Record<string, string> = { MCHS: "101", Police: "102", SMP: "103", MOSGAZ: "104" };

/** Header type («Происшествие 101») and «Класс.» of a card: classifier first, the scenario's card as a fallback. */
export async function typeInfos(incidents: IncidentFull[]): Promise<Map<string, TypeInfo>> {
  const codes = [...new Set(incidents.flatMap((i) => i.typeCodes))];
  const types = codes.length
    ? await db.incidentType.findMany({ where: { code: { in: codes } }, select: { code: true, finalType: true, mainService: true } })
    : [];
  const byCode = new Map(types.map((t) => [t.code, t]));
  const out = new Map<string, TypeInfo>();
  for (const i of incidents) {
    // A card saved at a 112 place shows what the operator chose, mistakes included — as in real work.
    const byOperator = i.source === "op112";
    const spec = i.scenario && !byOperator ? ddsCardOf(i.scenario) : null;
    const known = i.typeCodes.map((c) => byCode.get(c)).filter((t): t is NonNullable<typeof t> => !!t);
    const finalTypes = known.length ? known.map((t) => t.finalType) : (spec?.finalTypes ?? []);
    const chosenCard = byOperator ? (i.tags as { card?: string }[] | null)?.find((t) => t.card)?.card : undefined;
    const cardType =
      spec?.cardType ?? chosenCard ?? (known[0]?.mainService ? MAIN_TO_CARD[known[0].mainService] : undefined) ?? finalTypes[0] ?? "Происшествие";
    out.set(i.id, { cardType, finalTypes });
  }
  return out;
}

export function historyOf(plate: PlateFull): HistoryItem[] {
  const items: HistoryItem[] = plate.events.map((e) => ({
    id: e.id,
    at: e.at.toISOString(),
    status: e.status,
    label: STATUS_LABEL[e.status],
    comment: e.comment,
    crewNumber: e.crewNumber,
    actor: e.actorLabel,
    late: e.late,
  }));
  // Plates added by a 112 place may come without the technical event.
  if (!items.some((e) => e.status === "ADDED")) {
    items.unshift({
      id: `${plate.id}-added`,
      at: plate.addedAt.toISOString(),
      status: "ADDED",
      label: STATUS_LABEL.ADDED,
      comment: null,
      crewNumber: null,
      actor: "оп. 0",
      late: false,
    });
  }
  return items;
}

export function plateView(plate: PlateFull, ownServiceId: number | null): PlateView {
  const history = historyOf(plate);
  const last = history[history.length - 1];
  return {
    id: plate.id,
    serviceId: plate.serviceId,
    shortName: plate.service.shortName,
    fullName: plate.service.fullName ?? plate.service.shortName,
    delivery: plate.service.delivery,
    phone: servicePhone(plate.service),
    own: plate.serviceId === ownServiceId,
    main: plate.isMain,
    vis: plate.addedBy === "vis",
    status: plate.status,
    label: STATUS_LABEL[plate.status],
    crewNumber: plate.crewNumber,
    addedAt: plate.addedAt.toISOString(),
    lastAt: last.at,
    lastLate: last.late,
    history,
  };
}

/** The first answer of the service (Принята / Не принята, or 103 closing without a crew). */
export function firstAnswer(plate: PlateFull) {
  return plate.events.find((e) => !awaitsAnswer(e.status)) ?? null;
}

export type FeedRow = {
  id: string;
  number: number;
  savedAt: string;
  operatorNo: string;
  armNo: string;
  cardType: string;
  victims: boolean;
  address: string;
  ownStatus: ServiceStatus;
  ownLabel: string;
  ownAddedAt: string;
  answeredAt: string | null;
  answerLate: boolean;
  /** 3 minutes to send the crew after «Принята» (null — not counting now). */
  crew: CrewTimer | null;
  closed: boolean;
  important: boolean;
  description: DescriptionEntry | null;
  preview: { services: string; caller: string; info: string };
};

export function feedRow(incident: IncidentFull, ownServiceId: number, info: TypeInfo, crew: CrewTimer | null = null): FeedRow | null {
  const own = incident.services.find((p) => p.serviceId === ownServiceId);
  if (!own) return null;
  const answer = firstAnswer(own);
  const log = (incident.descriptionLog as DescriptionEntry[] | null) ?? [];
  const caller = (incident.caller as IncidentCaller | null) ?? {};
  const flags = (incident.flags as IncidentFlags | null) ?? {};
  const services = incident.services
    .filter((p) => p.serviceId !== ownServiceId)
    .map((p) => {
      const last = p.events[p.events.length - 1];
      return `${p.service.shortName} — ${fmtHM(last?.at ?? p.addedAt)} ${STATUS_LABEL[p.status]}`;
    })
    .join(", ");
  return {
    id: incident.id,
    number: incident.number,
    savedAt: (incident.savedAt ?? incident.createdAt).toISOString(),
    operatorNo: incident.operatorNo ?? (incident.source === "vis" ? "ВИС" : "0"),
    armNo: incident.armNo ?? "",
    cardType: info.cardType,
    victims: !!flags.victims,
    address: addressFeed(incident.address as IncidentAddress | null),
    ownStatus: own.status,
    ownLabel: STATUS_LABEL[own.status],
    ownAddedAt: own.addedAt.toISOString(),
    answeredAt: answer?.at.toISOString() ?? null,
    answerLate: !!answer?.late,
    crew,
    closed: isClosed(own.status) || own.status === "REJECTED",
    important: incident.important,
    description: log.length ? log[log.length - 1] : incident.description ? { at: "", author: "", text: incident.description } : null,
    preview: {
      services,
      caller: [caller.fullName, caller.status, caller.aon && `АОН ${caller.aon}`, caller.provided && `предоставленный ${caller.provided}`]
        .filter(Boolean)
        .join(", "),
      info: tagsLine(incident.tags as TagChoice[] | null),
    },
  };
}

export type CardView = {
  id: string;
  number: number;
  source: string;
  savedAt: string;
  operatorNo: string;
  armNo: string;
  caller: IncidentCaller;
  addressTitle: string;
  addressSecond: string;
  descriptionLog: DescriptionEntry[];
  flags: { victims: boolean; refusedAmbulance: boolean; blocked: boolean };
  important: boolean;
  cardType: string;
  tagsLine: string;
  classLine: string;
  plates: PlateView[];
};

export function cardView(incident: IncidentFull, ownServiceId: number | null, info: TypeInfo): CardView {
  const address = (incident.address as IncidentAddress | null) ?? {};
  const flags = (incident.flags as IncidentFlags | null) ?? {};
  const log = (incident.descriptionLog as DescriptionEntry[] | null) ?? [];
  return {
    id: incident.id,
    number: incident.number,
    source: incident.source,
    savedAt: (incident.savedAt ?? incident.createdAt).toISOString(),
    operatorNo: incident.operatorNo ?? "",
    armNo: incident.armNo ?? "",
    caller: (incident.caller as IncidentCaller | null) ?? {},
    addressTitle: addressTitle(address),
    addressSecond: address.descriptive ?? "",
    descriptionLog: log.length
      ? log
      : incident.description
        ? [{ at: (incident.savedAt ?? incident.createdAt).toISOString(), author: "", text: incident.description }]
        : [],
    flags: { victims: !!flags.victims, refusedAmbulance: !!flags.refusedAmbulance, blocked: !!flags.noAccess },
    important: incident.important,
    cardType: info.cardType,
    tagsLine: tagsLine(incident.tags as TagChoice[] | null),
    classLine: classLine(info.finalTypes),
    plates: incident.services.map((p) => plateView(p, ownServiceId)),
  };
}
