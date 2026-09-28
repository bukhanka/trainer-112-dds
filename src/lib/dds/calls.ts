/**
 * The phone of the ДДС place, text mode. Statuses come from the phone (#691), both ways:
 *   — the crew leader calls in with a report when the crew reaches a stage (BRIGADE_IN, rings 25 s);
 *   — the dispatcher calls the crew, the applicant (#739–740) or another service from the card.
 * Every line is kept in Call.messages; crew reports are also kept in Call.counterpart.reports so the
 * review can check that the matching status was set in time. «Удержание» parks a call (status HELD, the
 * periods in Call.holds): the counterpart waits and the line is free for another call.
 */
import type { Call, CallKind, Prisma, ServiceStatus } from "@prisma/client";
import { chat, type ChatMessage } from "@/lib/ai/provider";
import { db } from "@/lib/db";
import { sayable } from "@/lib/speech/sayable";
import type { CallerPersona, IncidentAddress, IncidentCaller } from "@/lib/incident/types";
import type { LessonSettings } from "@/lib/lessons/settings";
import { cardErrorFixed, correctedCard, fixLabel } from "./card-fix";
import { CREW_PACE_SEC, crewPlanFor, crewSchedule, dispatchOf, stageAt, type Dispatch } from "./crew";
import { addressShort, BOOK_112_GROUP, fmtHM } from "./format";
import { endHold, openHold, readHolds, resumeLine, startHold, type HoldPeriod } from "./hold";
import {
  atSite,
  callerGreeting,
  callerMockReply,
  callerPrompt,
  cardErrorLine,
  claimsCardChange,
  crewByNumber,
  crewGreeting,
  crewMockReply,
  crewNumberOf,
  crewPrompt,
  crewRoster,
  mentionsCardError,
  mentionsCardNumber,
  OPERATOR_112,
  operatorGreeting,
  operatorMockReply,
  operatorPrompt,
  owesCardError,
  reportLine,
  reportsCardError,
  serviceGreeting,
  serviceMockReply,
  servicePhone,
  servicePrompt,
  type CrewContext,
  type CrewMember,
  type OperatorState,
} from "./personas";
import { cardErrorFrom, ddsCardOf, personaOf, referenceFor, saysCardErrorRight, type CardError } from "./scenario";
import { cardReference, movedPersona, wasMoved } from "./territory";
import { seatFeedWhere, settingsOf } from "./scope";
import type { DdsSeat } from "./seat";
import { DDS_TX as TX, isBusyError, SERVER_BUSY } from "./tx";

type Tx = Prisma.TransactionClient;
/** What the phone needs to know about the place. */
type PhoneSeat = Pick<DdsSeat, "id" | "lessonId" | "serviceId" | "service" | "lesson">;

/** An unanswered incoming call is lost after this many seconds. */
export const RING_SEC = 25;
/** A counterpart waits on hold this long, then hangs up. */
export const HOLD_MAX_SEC = 180;



export type CallMessage = { role: "counterpart" | "trainee"; text: string; at: string };
export type Report = { status: ServiceStatus | "DISPATCHED"; at: string };

export type Counterpart = {
  kind: "crew" | "caller" | "service" | "contact" | "operator112";
  name: string;
  role: string;
  phone?: string;
  voice?: "male" | "female";
  crew?: string;
  /** Incoming crew call: the stage it was ringing to report. */
  stage?: ServiceStatus;
  /** Stages the crew told the dispatcher during this call. */
  reports?: Report[];
  /** The crew was sent to the card by this call. */
  dispatch?: { incidentId: string; at: string };
  /** Persona temper of an applicant, for the manner of the voice. */
  temper?: string;
  serviceId?: number;
  /** Callback: the dispatcher said the card number (the applicant must not hear it, #740). */
  namedCardNumber?: boolean;
};

const cp = (call: Pick<Call, "counterpart">) => (call.counterpart ?? {}) as Counterpart;
const msgs = (call: Pick<Call, "messages">) => (call.messages ?? []) as CallMessage[];

const incidentInclude = {
  services: { include: { service: true, events: { orderBy: { at: "asc" } } }, orderBy: [{ addedAt: "asc" }, { id: "asc" }] },
  scenario: { select: { id: true, title: true, category: true, caller: true, truth: true, ddsCard: true, ddsReference: true } },
} satisfies Prisma.IncidentInclude;
type CallIncident = Prisma.IncidentGetPayload<{ include: typeof incidentInclude }>;

/** Digits of a phone number, «8…» turned into «7…». */
export function normPhone(value: string): string {
  const d = value.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("8") ? `7${d.slice(1)}` : d;
}

function phoneDispatches(calls: Pick<Call, "counterpart">[], incidentId: string): { crew: string; at: Date }[] {
  return calls
    .map(cp)
    .filter((c) => c.kind === "crew" && c.crew && c.dispatch?.incidentId === incidentId)
    .map((c) => ({ crew: c.crew!, at: new Date(c.dispatch!.at) }));
}

type CrewState = {
  dispatch: Dispatch | null;
  stage: ServiceStatus | null;
  /** Stages the dispatcher has heard from the crew on this card (answered reports, calls to the crew). */
  heard: Set<ServiceStatus | "DISPATCHED">;
  ctxFor: (member: CrewMember) => CrewContext;
};

const STAGE_DONE: Partial<Record<ServiceStatus, string>> = {
  STARTED: "выехали",
  ARRIVED: "прибыли",
  WORKING: "начали работы",
  FINISHED: "закончили",
  REFUSED: "закончили",
};

function crewState(seat: PhoneSeat, incident: CallIncident, calls: Pick<Call, "counterpart">[], settings: LessonSettings, now: Date): CrewState {
  const own = incident.services.find((p) => p.serviceId === seat.serviceId);
  const dispatch = own ? dispatchOf(own.events, phoneDispatches(calls, incident.id)) : null;
  const ref = seat.service ? cardReference(incident.scenario?.ddsReference, seat.service, incident.address) : null;
  const { chain, plan } = crewPlanFor(ref);
  const schedule = crewSchedule(chain, CREW_PACE_SEC);
  const elapsed = dispatch ? (now.getTime() - dispatch.at.getTime()) / 1000 : 0;
  let stage = dispatch ? stageAt(schedule, elapsed) : null;
  // Once the dispatcher closed the plate the crew is done as well.
  if (dispatch && own && (own.status === "FINISHED" || own.status === "REFUSED")) stage = own.status;
  const address = addressShort(incident.address as IncidentAddress | null);
  const heard = new Set(calls.flatMap((c) => (cp(c).reports ?? []).map((r) => r.status)));
  // «Во сколько прибыли?»: the moments of the stages already behind, by the clock of the place.
  const timeline = dispatch
    ? schedule
        .filter((s) => s.afterSec <= elapsed && STAGE_DONE[s.status])
        .map((s) => `${STAGE_DONE[s.status]} в ${fmtHM(new Date(dispatch.at.getTime() + s.afterSec * 1000))}`)
        .join(", ")
    : "";
  return {
    dispatch,
    stage,
    heard,
    ctxFor: (member) => ({
      crew: member.crew,
      leader: member.leader,
      title: member.title,
      address,
      what: incident.description ?? incident.scenario?.title ?? "",
      plan,
      dispatched: dispatch?.crew === member.crew,
      stage: dispatch?.crew === member.crew ? stage : null,
      errorTold: [...heard].some((s) => atSite(s)),
      errorFixed: cardErrorFixed(incident.descriptionLog),
      timeline: dispatch?.crew === member.crew ? timeline : "",
    }),
  };
}

function callerPersona(incident: CallIncident): CallerPersona {
  const persona = incident.scenario ? personaOf(incident.scenario) : null;
  if (persona && incident.scenario && incident.source === "generated") {
    // A card moved onto the place's territory (territory.ts): the applicant gives the address written on the card.
    const from = ddsCardOf(incident.scenario).address;
    const to = incident.address as IncidentAddress | null;
    if (to && wasMoved(to, from)) return movedPersona(persona, from, to, incident.description ?? undefined);
  }
  if (persona) return persona;
  const caller = (incident.caller as IncidentCaller | null) ?? {};
  return {
    fullName: caller.fullName ?? "Заявитель",
    role: caller.status ?? "заявитель",
    visibleAddress: addressShort(incident.address as IncidentAddress | null),
    situation: incident.description ?? "",
    facts: [],
    temper: "calm",
  };
}

// ─── The flow step: crew reports and lost calls ─────────────────────────────

/** Called from ensureDdsFlow inside its transaction. */
export async function phoneTick(tx: Tx, seat: PhoneSeat, settings: LessonSettings, now: Date): Promise<void> {
  await tx.call.updateMany({
    where: { seatId: seat.id, status: "RINGING", startedAt: { lt: new Date(now.getTime() - RING_SEC * 1000) } },
    data: { status: "MISSED", endedAt: now },
  });
  // A counterpart left on hold for too long hangs up. Conditional on HELD: a resume a moment ago wins.
  for (const call of await tx.call.findMany({ where: { seatId: seat.id, status: "HELD" }, select: { id: true, holds: true, messages: true } })) {
    const open = openHold(readHolds(call.holds));
    if (!open || now.getTime() - Date.parse(open.from) < HOLD_MAX_SEC * 1000) continue;
    await tx.call.updateMany({
      where: { id: call.id, status: "HELD" },
      data: {
        status: "ENDED",
        endedAt: now,
        holds: endHold(readHolds(call.holds), now) as Prisma.InputJsonValue,
        messages: [...msgs(call), { role: "counterpart", text: "Не дождался на удержании и положил трубку.", at: now.toISOString() }] as Prisma.InputJsonValue,
      },
    });
  }
  if (!settings.brigadeReports || !seat.serviceId || !seat.service) return;

  const open = await tx.incident.findMany({
    where: {
      AND: [seatFeedWhere(seat, settings), { services: { some: { serviceId: seat.serviceId, status: { in: ["ACCEPTED", "STARTED", "ARRIVED", "WORKING"] } } } }],
    },
    include: incidentInclude,
  });
  if (!open.length) return;
  const calls = await tx.call.findMany({
    where: { seatId: seat.id, incidentId: { in: open.map((i) => i.id) }, kind: { in: ["BRIGADE_IN", "BRIGADE_OUT"] } },
  });

  for (const incident of open) {
    const mine = calls.filter((c) => c.incidentId === incident.id);
    const state = crewState(seat, incident, mine, settings, now);
    if (!state.dispatch || !state.stage) continue;
    const told = new Set(mine.flatMap((c) => [...(cp(c).reports ?? []).map((r) => r.status), cp(c).stage]));
    if (told.has(state.stage)) continue;
    if (mine.some((c) => c.status === "RINGING" || c.status === "ACTIVE" || c.status === "HELD")) continue;
    const member = crewByNumber(seat.service, state.dispatch.crew);
    const counterpart: Counterpart = {
      kind: "crew",
      crew: member.crew,
      name: member.leader,
      role: `старший наряда ${member.crew}`,
      phone: member.phone,
      voice: member.voice,
      stage: state.stage,
    };
    await tx.call.create({
      data: {
        lessonId: seat.lessonId,
        seatId: seat.id,
        incidentId: incident.id,
        kind: "BRIGADE_IN",
        status: "RINGING",
        counterpart: counterpart as Prisma.InputJsonValue,
        messages: [],
        startedAt: now,
      },
    });
  }
}

// ─── What the screen shows ───────────────────────────────────────────────────

export type CallBrief = {
  id: string;
  kind: CallKind;
  incoming: boolean;
  status: Call["status"];
  incidentId: string | null;
  incidentNumber: number | null;
  name: string;
  role: string;
  phone: string | null;
  /** Crew number of a crew call: the journal calls the crew back by it when the crew has no phone in the book. */
  crew: string | null;
  /** Voice of the counterpart for speech synthesis. */
  voice: "male" | "female";
  /** Speaking manner: a crew leader reports briskly, the applicant keeps the persona's temper. */
  manner: string;
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  messages: CallMessage[];
  /** «Удержание» periods; the last one is open while the call waits on hold. */
  holds: HoldPeriod[];
};

export type BookEntry = { group: string; name: string; role: string; phone: string; incidentId?: string };

export type PhoneState = {
  current: CallBrief | null;
  ringing: CallBrief[];
  /** Calls waiting on hold, the latest first. */
  held: CallBrief[];
  log: CallBrief[];
  book: BookEntry[];
  crews: CrewMember[];
};

function brief(call: Call & { incident: { number: number } | null }): CallBrief {
  const c = cp(call);
  return {
    id: call.id,
    kind: call.kind,
    incoming: call.kind === "BRIGADE_IN" || call.kind === "CONTROL_IN",
    status: call.status,
    incidentId: call.incidentId,
    incidentNumber: call.incident?.number ?? null,
    name: c.name ?? "",
    role: c.role ?? "",
    phone: c.phone || null,
    crew: c.kind === "crew" ? (c.crew ?? null) : null,
    voice: c.voice ?? (c.kind === "crew" ? "male" : "female"),
    manner: c.kind === "crew" ? "brigade" : (c.temper ?? "calm"),
    startedAt: call.startedAt.toISOString(),
    answeredAt: call.answeredAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
    messages: msgs(call),
    holds: readHolds(call.holds),
  };
}

export async function phoneState(seat: DdsSeat): Promise<PhoneState> {
  const include = { incident: { select: { number: true } } } satisfies Prisma.CallInclude;
  // The journal shows the latest 40; calls still going on (ringing, talking, on hold) come whatever their age.
  const [recent, live] = await Promise.all([
    db.call.findMany({ where: { seatId: seat.id }, orderBy: { startedAt: "desc" }, take: 40, include }),
    db.call.findMany({ where: { seatId: seat.id, status: { in: ["RINGING", "ACTIVE", "HELD"] } }, orderBy: { startedAt: "desc" }, include }),
  ]);
  const calls = [...new Map([...live, ...recent].map((c) => [c.id, c])).values()].sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const briefs = calls.map(brief);
  return {
    current: briefs.find((c) => c.status === "ACTIVE") ?? null,
    ringing: briefs.filter((c) => c.status === "RINGING"),
    held: briefs.filter((c) => c.status === "HELD"),
    log: briefs,
    book: await phoneBook(seat),
    crews: seat.service ? crewRoster(seat.service) : [],
  };
}

/** The book entry of the 112 operator: the memo's call when the card has an error or the situation changed. */
export const BOOK_112: BookEntry = { group: BOOK_112_GROUP, name: OPERATOR_112, role: "оператор: ошибка в карточке, изменилась обстановка", phone: "112" };

/** The place's phone book: its crews, the 112 operator, and for every open card the applicant, the other services and contacts. */
export async function phoneBook(seat: DdsSeat): Promise<BookEntry[]> {
  const entries: BookEntry[] = [];
  if (seat.service) {
    for (const c of crewRoster(seat.service)) {
      entries.push({ group: `Наряды: ${seat.service.shortName}`, name: `Наряд ${c.crew} — ${c.title}`, role: `старший ${c.leader}`, phone: c.phone });
    }
  }
  entries.push(BOOK_112);
  if (!seat.serviceId) return entries;
  const recent = new Date(Date.now() - 30 * 60_000);
  const incidents = await db.incident.findMany({
    where: {
      AND: [
        seatFeedWhere(seat, settingsOf(seat.lesson.settings)),
        {
          services: {
            some: { serviceId: seat.serviceId, OR: [{ status: { notIn: ["FINISHED", "REFUSED"] } }, { addedAt: { gte: recent } }] },
          },
        },
      ],
    },
    include: incidentInclude,
    orderBy: { createdAt: "desc" },
    take: 12,
  });
  for (const i of incidents) {
    const group = `Карточка ${i.number}`;
    const caller = (i.caller as IncidentCaller | null) ?? {};
    const phone = caller.provided ?? caller.aon ?? caller.onSite;
    if (phone) entries.push({ group, name: caller.fullName ?? "Заявитель", role: "заявитель", phone, incidentId: i.id });
    for (const p of i.services) {
      if (p.serviceId === seat.serviceId) continue;
      entries.push({ group, name: p.service.shortName, role: "дежурный диспетчер", phone: servicePhone(p.service), incidentId: i.id });
    }
    const ref = seat.service ? referenceFor(i.scenario?.ddsReference, seat.service) : null;
    for (const c of ref?.contacts ?? []) entries.push({ group, name: c.name, role: "дежурный диспетчер", phone: c.phone, incidentId: i.id });
  }
  return entries;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

export type CallResult = { ok: true; call: CallBrief } | { ok: false; error: string; code: number };

const fail = (error: string, code = 422): CallResult => ({ ok: false, error, code });

async function feedIncidents(seat: DdsSeat) {
  return db.incident.findMany({ where: seatFeedWhere(seat, settingsOf(seat.lesson.settings)), include: incidentInclude, orderBy: { createdAt: "desc" }, take: 40 });
}

async function reload(id: string): Promise<CallBrief> {
  const call = await db.call.findUniqueOrThrow({ where: { id }, include: { incident: { select: { number: true } } } });
  return brief(call);
}

/** Dial a number from the card, the phone book or the keypad. */
async function dialNumber(seat: DdsSeat, number: string, incidentId: string | null | undefined, now: Date, cardNumber?: number | null): Promise<CallResult> {
  if (seat.lesson.status !== "RUNNING") return fail("Занятие завершено", 409);
  if (!seat.service) return fail("У места не выбрана служба", 409);
  if (await db.call.findFirst({ where: { seatId: seat.id, status: "ACTIVE" }, select: { id: true } })) return fail(BUSY, 409);
  const typed = number.trim();
  const digits = normPhone(typed);
  if (!digits) return fail("Наберите номер");

  const settings = settingsOf(seat.lesson.settings);
  const incidents = await feedIncidents(seat);
  // The card the call is made from: named by the book or the card's phone icons, else the card open on the screen.
  // Scenarios repeat, so one applicant's number may stand on several cards: the open card wins.
  const context = incidentId ? incidents.find((i) => i.id === incidentId) : cardNumber ? incidents.find((i) => i.number === cardNumber) : undefined;
  const ordered = context ? [context, ...incidents.filter((i) => i !== context)] : incidents;

  // Another service of a card, by its phone (101, 102…).
  for (const i of ordered) {
    const plate = i.services.find((p) => p.serviceId !== seat.serviceId && normPhone(servicePhone(p.service)) === digits);
    if (plate) {
      const counterpart: Counterpart = { kind: "service", name: plate.service.shortName, role: "дежурный диспетчер", phone: servicePhone(plate.service), serviceId: plate.serviceId };
      const greeting = serviceGreeting({ name: plate.service.shortName, ownService: seat.service.shortName, address: "", what: "" });
      return startCall(seat, "SERVICE_OUT", i.id, counterpart, greeting, now);
    }
  }

  // The 112 operator: the memo's call when the situation on site changed.
  if (digits === "112") {
    const counterpart: Counterpart = { kind: "operator112", name: OPERATOR_112, role: "оператор", phone: "112" };
    return startCall(seat, "SERVICE_OUT", context?.id ?? null, counterpart, operatorGreeting(), now);
  }

  // Any other service of the list by its phone, even if it is not on the card.
  const listed = await db.service.findMany({ where: { NOT: { id: seat.serviceId! } }, select: { id: true, shortName: true, phone: true } });
  const byPhone = listed.find((sv) => normPhone(servicePhone(sv)) === digits);
  if (byPhone) {
    const counterpart: Counterpart = { kind: "service", name: byPhone.shortName, role: "дежурный диспетчер", phone: servicePhone(byPhone), serviceId: byPhone.id };
    return startCall(seat, "SERVICE_OUT", context?.id ?? null, counterpart, serviceGreeting({ name: byPhone.shortName, ownService: seat.service.shortName, address: "", what: "" }), now);
  }

  // A crew of the place: by phone, by a crew number from the book, or by a number already used on its cards.
  const roster = crewRoster(seat.service);
  const calls = await db.call.findMany({ where: { seatId: seat.id, kind: { in: ["BRIGADE_IN", "BRIGADE_OUT"] } } });
  const usedCrews = new Set(
    incidents.flatMap((i) => i.services.filter((p) => p.serviceId === seat.serviceId).flatMap((p) => p.events.map((e) => e.crewNumber).filter(Boolean) as string[])),
  );
  const asCrew = crewNumberOf(typed);
  const member =
    roster.find((c) => normPhone(c.phone) === digits || c.crew === asCrew) ?? (usedCrews.has(asCrew) ? crewByNumber(seat.service, asCrew) : null);
  if (member) {
    // The crew talks about the card it works on; a free crew about the card the call is made from.
    const busyOn = incidents.find((i) => {
      const own = i.services.find((p) => p.serviceId === seat.serviceId);
      if (!own || own.status === "REJECTED") return false;
      return dispatchOf(own.events, phoneDispatches(calls, i.id))?.crew === member.crew && !["FINISHED", "REFUSED"].includes(own.status);
    });
    const where = busyOn ?? context ?? null;
    const state = where ? crewState(seat, where, calls.filter((c) => c.incidentId === where.id), settings, now) : null;
    const ctx = state?.ctxFor(member) ?? null;
    // A stage the dispatcher has not heard (the report call was missed): the leader reports it on picking up,
    // the card error included — as in the report itself.
    const news = !!ctx?.dispatched && !!ctx.stage && !state!.heard.has(ctx.stage);
    const counterpart: Counterpart = {
      kind: "crew",
      crew: member.crew,
      name: member.leader,
      role: `старший наряда ${member.crew}`,
      phone: member.phone,
      voice: member.voice,
      ...(news ? { reports: [{ status: ctx!.stage!, at: now.toISOString() }] } : {}),
    };
    const greeting = ctx ? crewGreeting(ctx, news) : `Наряд ${member.crew}, ${member.leader.split(" ")[0]}. Мы на базе, свободны. Куда выезжать?`;
    return startCall(seat, "BRIGADE_OUT", where?.id ?? null, counterpart, greeting, now);
  }

  // The applicant of a card.
  const byCaller = ordered.find((i) => {
    const c = (i.caller as IncidentCaller | null) ?? {};
    return [c.aon, c.provided, c.onSite].some((p) => p && normPhone(p) === digits);
  });
  if (byCaller) {
    const persona = callerPersona(byCaller);
    const counterpart: Counterpart = { kind: "caller", name: persona.fullName, role: persona.role, phone: typed, voice: persona.voice, temper: persona.temper };
    return startCall(seat, "CALLER_OUT", byCaller.id, counterpart, callerGreeting(persona), now);
  }

  // An organisation named in the reference (a managing company, a utility).
  for (const i of ordered) {
    const contact = referenceFor(i.scenario?.ddsReference, seat.service)?.contacts.find((c) => normPhone(c.phone) === digits);
    if (contact) {
      const counterpart: Counterpart = { kind: "contact", name: contact.name, role: "дежурный диспетчер", phone: contact.phone };
      return startCall(seat, "SERVICE_OUT", i.id, counterpart, serviceGreeting({ name: contact.name, ownService: seat.service.shortName, address: "", what: "" }), now);
    }
  }
  return fail("Абонент не найден: наберите номер из карточки или из телефонной книжки", 404);
}

/** One line per place: taking the handset (dialling, answering, hold) is serialised by this lock. */
async function lockLine(tx: Prisma.TransactionClient, seatId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dds-line:${seatId}`}))`;
  return !!(await tx.call.findFirst({ where: { seatId, status: "ACTIVE" }, select: { id: true } }));
}

/** Lines of one call (messages, hold periods) are rewritten under this lock; taken after the line lock. */
async function lockCall(tx: Prisma.TransactionClient, callId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dds-call:${callId}`}))`;
}

const BUSY = "Сначала положите трубку текущего разговора";

async function startCall(seat: DdsSeat, kind: CallKind, incidentId: string | null, counterpart: Counterpart, greeting: string, now: Date): Promise<CallResult> {
  const id = await db.$transaction(async (tx) => {
    if (await lockLine(tx, seat.id)) return null;
    const call = await tx.call.create({
      data: {
        lessonId: seat.lessonId,
        seatId: seat.id,
        incidentId,
        kind,
        status: "ACTIVE",
        counterpart: counterpart as Prisma.InputJsonValue,
        messages: [{ role: "counterpart", text: sayable(greeting), at: now.toISOString() }],
        startedAt: now,
        answeredAt: now,
      },
    });
    return call.id;
  }, TX);
  if (!id) return fail(BUSY, 409);
  return { ok: true, call: await reload(id) };
}

async function ownCall(seat: DdsSeat, callId: string) {
  return db.call.findFirst({ where: { id: callId, seatId: seat.id } });
}

async function incidentFor(seat: DdsSeat, incidentId: string | null): Promise<CallIncident | null> {
  if (!incidentId) return null;
  return db.incident.findFirst({ where: { AND: [{ id: incidentId }, seatFeedWhere(seat, settingsOf(seat.lesson.settings))] }, include: incidentInclude });
}

/** Pick up an incoming call: the crew leader speaks first with the report. */
async function answerCall(seat: DdsSeat, callId: string, now: Date): Promise<CallResult> {
  const call = await ownCall(seat, callId);
  if (!call) return fail("Звонок не найден", 404);
  if (call.status !== "RINGING") return fail("Звонок уже завершён", 409);
  // A ring longer than RING_SEC is lost: the flow is turning it into a missed call right now, and
  // answering it would only wait for the flow's transaction.
  if (now.getTime() - call.startedAt.getTime() > RING_SEC * 1000) return fail("Звонок уже пропущен — перезвоните сами", 409);
  const c = cp(call);
  const incident = await incidentFor(seat, call.incidentId);
  let text = "Диспетчер, слушаю.";
  const reports = [...(c.reports ?? [])];
  if (c.kind === "crew" && incident && seat.service) {
    const calls = await db.call.findMany({ where: { seatId: seat.id, incidentId: incident.id, kind: { in: ["BRIGADE_IN", "BRIGADE_OUT"] } } });
    const state = crewState(seat, incident, calls, settingsOf(seat.lesson.settings), now);
    const ctx = state.ctxFor(crewByNumber(seat.service, c.crew ?? ""));
    const stage = ctx.stage ?? c.stage ?? null;
    text = reportLine(stage, ctx);
    if (stage) reports.push({ status: stage, at: now.toISOString() });
  }
  const result = await db.$transaction(async (tx) => {
    if (await lockLine(tx, seat.id)) return BUSY;
    const moved = await tx.call.updateMany({
      where: { id: call.id, status: "RINGING" },
      data: {
        status: "ACTIVE",
        answeredAt: now,
        counterpart: { ...c, reports } as Prisma.InputJsonValue,
        messages: [...msgs(call), { role: "counterpart", text: sayable(text), at: now.toISOString() }],
      },
    });
    return moved.count ? null : "Звонок уже завершён";
  }, TX);
  if (result) return fail(result, 409);
  return { ok: true, call: await reload(call.id) };
}

const ON_HOLD = "Разговор на удержании — сначала снимите его с удержания";

/**
 * The dispatcher's call to 112 about a card of the place (customer's answer of 27.09). When the words so far name a
 * card with an error in it — by its number — and the right information, the operator corrects the card: the fields of
 * the fix and a line «Изменено оператором 112» in its journal (card-fix.ts). The operator's words follow the result.
 */
async function operatorTurn(seat: DdsSeat, said: string, now: Date): Promise<OperatorState> {
  const named = (await feedIncidents(seat)).filter((i) => mentionsCardNumber(said, i.number));
  const withError = named.map((i) => ({ incident: i, error: cardErrorFrom(i.scenario?.ddsReference) })).filter((x): x is { incident: CallIncident; error: CardError } => !!x.error);
  const told = withError.find((x) => saysCardErrorRight(said, x.error));
  if (told) {
    const { incident, error } = told;
    const label = fixLabel(error);
    if (cardErrorFixed(incident.descriptionLog)) return { kind: "already", card: incident.number, label };
    const fixed = await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dds-card-fix:${incident.id}`}))`;
      const fresh = await tx.incident.findUnique({ where: { id: incident.id }, select: { address: true, flags: true, descriptionLog: true } });
      if (!fresh || cardErrorFixed(fresh.descriptionLog)) return false;
      const next = correctedCard(fresh, error, seat.service?.shortName ?? "ДДС", now);
      await tx.incident.update({
        where: { id: incident.id },
        data: {
          address: next.address as Prisma.InputJsonValue,
          flags: next.flags as Prisma.InputJsonValue,
          descriptionLog: next.descriptionLog as Prisma.InputJsonValue,
        },
      });
      return true;
    }, TX);
    return { kind: fixed ? "fixed" : "already", card: incident.number, label };
  }
  if (reportsCardError(said)) {
    if (withError.length) return { kind: "needInfo", card: withError[0].incident.number };
    if (!named.length) return { kind: "needNumber" };
  }
  return { kind: "none", card: named[0]?.number ?? null };
}

/** Say a line in the current call and get the answer (model, or the offline lines). */
async function sayLine(seat: DdsSeat, callId: string, text: string, now: Date): Promise<CallResult> {
  const call = await ownCall(seat, callId);
  if (!call) return fail("Звонок не найден", 404);
  if (call.status !== "ACTIVE") return fail(call.status === "HELD" ? ON_HOLD : "Разговор уже завершён", 409);
  const line = text.trim().replace(/\s+/g, " ").slice(0, 600);
  if (!line) return fail("Пустая реплика");

  const c: Counterpart = { ...cp(call) };
  const history = msgs(call);
  const turn = history.filter((m) => m.role === "trainee").length + 1;
  const incident = await incidentFor(seat, call.incidentId);
  const settings = settingsOf(seat.lesson.settings);

  let prompt: string;
  let fallback: string;
  /** Checks the model's line against the facts: a line that breaks them is replaced or completed. */
  let settle = (text: string) => text;
  if (c.kind === "crew" && seat.service) {
    const member = crewByNumber(seat.service, c.crew ?? "");
    const calls = incident ? await db.call.findMany({ where: { seatId: seat.id, incidentId: incident.id, kind: { in: ["BRIGADE_IN", "BRIGADE_OUT"] } } }) : [];
    const state = incident ? crewState(seat, incident, calls, settings, now) : null;
    const ctx: CrewContext = state?.ctxFor(member) ?? {
      crew: member.crew,
      leader: member.leader,
      title: member.title,
      address: "",
      what: "",
      plan: {},
      dispatched: false,
      stage: null,
    };
    const reply = crewMockReply(ctx, line, turn);
    // A free crew sent to a card by phone starts its trip now (only one crew per card).
    if (reply.dispatch && incident && !state?.dispatch) c.dispatch = { incidentId: incident.id, at: now.toISOString() };
    if (reply.dispatch && !incident) reply.text = "Назовите адрес и что случилось — без этого не выедем.";
    // The crew on site still owes the dispatcher the error in the card: this line carries it, whatever the model
    // says, and counts as a report from the site.
    const owes = owesCardError(ctx);
    const reported = reply.reported ?? (owes ? ctx.stage : null);
    if (reported) c.reports = [...(c.reports ?? []), { status: reported, at: now.toISOString() }];
    prompt = crewPrompt(ctx);
    fallback = reply.text;
    if (owes) settle = (text) => (mentionsCardError(text, ctx) ? text : `${text.replace(/\s+$/, "")} ${cardErrorLine(ctx)}`);
  } else if (c.kind === "operator112") {
    const state = await operatorTurn(seat, [...history.filter((m) => m.role === "trainee").map((m) => m.text), line].join(" "), now);
    prompt = operatorPrompt(seat.service?.shortName ?? "", state);
    fallback = operatorMockReply(line, turn, state);
    // The operator claims a correction only when the card has really been corrected.
    if (state.kind !== "fixed" && state.kind !== "already") settle = (text) => (claimsCardChange(text) ? fallback : text);
  } else if (c.kind === "caller" && incident) {
    const persona = callerPersona(incident);
    if (mentionsCardNumber(line, incident.number)) c.namedCardNumber = true;
    prompt = callerPrompt({ persona, cardNumber: incident.number });
    fallback = callerMockReply({ persona, cardNumber: incident.number }, line, turn);
  } else {
    const plate = c.serviceId ? incident?.services.find((p) => p.serviceId === c.serviceId) : undefined;
    const ctx = {
      name: c.name,
      ownService: seat.service?.shortName ?? "",
      address: addressShort(incident?.address as IncidentAddress | null),
      what: incident?.description ?? "",
      status: plate?.status,
      crew: plate?.crewNumber,
    };
    prompt = servicePrompt(ctx);
    fallback = serviceMockReply(ctx, line, turn);
  }

  const answerText = settle(await speakAs(prompt, history, line, fallback));
  const said: CallMessage[] = [
    { role: "trainee", text: line, at: now.toISOString() },
    // The counterpart's words as they sound: no «ул.», «д.», «03» in speech (src/lib/speech/sayable.ts).
    { role: "counterpart", text: sayable(answerText), at: new Date().toISOString() },
  ];
  // The model may take seconds: append to the call as it is now, and only while it is still going.
  const before = cp(call);
  const newReports = (c.reports ?? []).slice((before.reports ?? []).length);
  const saved = await db.$transaction(async (tx) => {
    await lockCall(tx, call.id);
    const fresh = await tx.call.findUnique({ where: { id: call.id } });
    if (!fresh || fresh.status !== "ACTIVE") return fresh?.status === "HELD" ? ON_HOLD : "Разговор уже завершён";
    const cur = cp(fresh);
    const merged: Counterpart = {
      ...cur,
      reports: [...(cur.reports ?? []), ...newReports],
      dispatch: cur.dispatch ?? c.dispatch,
      namedCardNumber: cur.namedCardNumber || c.namedCardNumber,
    };
    await tx.call.update({
      where: { id: call.id },
      data: { messages: [...msgs(fresh), ...said] as Prisma.InputJsonValue, counterpart: merged as Prisma.InputJsonValue },
    });
    return null;
  }, TX);
  if (saved) return fail(saved, 409);
  return { ok: true, call: await reload(call.id) };
}

async function speakAs(prompt: string, history: CallMessage[], line: string, fallback: string): Promise<string> {
  const messages: ChatMessage[] = [
    { role: "system", content: prompt },
    ...history.map((m): ChatMessage => ({ role: m.role === "trainee" ? "user" : "assistant", content: m.text })),
    { role: "user", content: line },
  ];
  try {
    const reply = await chat(messages, { mock: () => fallback, maxTokens: 160, temperature: 0.5 });
    return reply.trim() || fallback;
  } catch (err) {
    console.error("dds call reply failed, offline line used", err);
    return fallback;
  }
}

/** Put the handset down: an active or held call ends, a ringing one is declined and counts as missed. */
async function hangUpCall(seat: DdsSeat, callId: string, now: Date): Promise<CallResult> {
  const call = await ownCall(seat, callId);
  if (!call) return fail("Звонок не найден", 404);
  // Under the same locks as hold and resume, on a fresh read: a conversation that a «Снять с удержания»
  // has just parked still ends, and a call answered a moment ago never turns into a missed one.
  await db.$transaction(async (tx) => {
    await lockLine(tx, seat.id);
    await lockCall(tx, call.id);
    const fresh = await tx.call.findUnique({ where: { id: call.id } });
    if (fresh?.status === "ACTIVE" || fresh?.status === "HELD") {
      // The counterpart hears the hang-up while waiting: an open hold period ends with the call.
      await tx.call.update({ where: { id: call.id }, data: { status: "ENDED", endedAt: now, holds: endHold(readHolds(fresh.holds), now) as Prisma.InputJsonValue } });
    } else if (fresh?.status === "RINGING") {
      await tx.call.update({ where: { id: call.id }, data: { status: "MISSED", endedAt: now } });
    }
  }, TX);
  return { ok: true, call: await reload(call.id) };
}

/** «Удержание»: the counterpart waits on the line, the line is free for another call. */
async function holdCall(seat: DdsSeat, callId: string, now: Date): Promise<CallResult> {
  const error = await db.$transaction(async (tx) => {
    await lockLine(tx, seat.id);
    await lockCall(tx, callId);
    const call = await tx.call.findFirst({ where: { id: callId, seatId: seat.id } });
    if (!call) return "Звонок не найден";
    if (call.status === "HELD") return null; // a second click: already waiting
    if (call.status !== "ACTIVE") return "Разговор уже завершён";
    await tx.call.update({ where: { id: call.id }, data: { status: "HELD", holds: startHold(readHolds(call.holds), now) as Prisma.InputJsonValue } });
    return null;
  }, TX);
  if (error) return fail(error, error === "Звонок не найден" ? 404 : 409);
  return { ok: true, call: await reload(callId) };
}

/**
 * «Снять с удержания»: back to the waiting counterpart, who says they are still on the line. One line per
 * place: a conversation going on now goes on hold in its turn, as on a switchboard.
 */
async function resumeCall(seat: DdsSeat, callId: string, now: Date): Promise<CallResult> {
  const error = await db.$transaction(async (tx) => {
    await lockLine(tx, seat.id);
    await lockCall(tx, callId);
    const call = await tx.call.findFirst({ where: { id: callId, seatId: seat.id } });
    if (!call) return "Звонок не найден";
    if (call.status === "ACTIVE") return null;
    if (call.status !== "HELD") return "Собеседник уже положил трубку";
    const talking = await tx.call.findFirst({ where: { seatId: seat.id, status: "ACTIVE" } });
    if (talking) {
      await lockCall(tx, talking.id);
      await tx.call.updateMany({
        where: { id: talking.id, status: "ACTIVE" },
        data: { status: "HELD", holds: startHold(readHolds(talking.holds), now) as Prisma.InputJsonValue },
      });
    }
    await tx.call.update({
      where: { id: call.id },
      data: {
        status: "ACTIVE",
        holds: endHold(readHolds(call.holds), now) as Prisma.InputJsonValue,
        messages: [...msgs(call), { role: "counterpart", text: sayable(resumeLine(cp(call).kind)), at: now.toISOString() }] as Prisma.InputJsonValue,
      },
    });
    return null;
  }, TX);
  if (error) return fail(error, error === "Звонок не найден" ? 404 : 409);
  return { ok: true, call: await reload(callId) };
}

/** A phone step that waited too long for a connection or a lock answers in words (503), not with a bare 500. */
async function guarded(step: () => Promise<CallResult>): Promise<CallResult> {
  try {
    return await step();
  } catch (err) {
    if (isBusyError(err)) {
      console.error("dds phone step did not get its turn", err);
      return fail(SERVER_BUSY, 503);
    }
    throw err;
  }
}

export const dial = (seat: DdsSeat, number: string, incidentId?: string | null, now = new Date(), cardNumber?: number | null) =>
  guarded(() => dialNumber(seat, number, incidentId, now, cardNumber));
export const answer = (seat: DdsSeat, callId: string, now = new Date()) => guarded(() => answerCall(seat, callId, now));
export const say = (seat: DdsSeat, callId: string, text: string, now = new Date()) => guarded(() => sayLine(seat, callId, text, now));
export const hangUp = (seat: DdsSeat, callId: string, now = new Date()) => guarded(() => hangUpCall(seat, callId, now));
export const hold = (seat: DdsSeat, callId: string, now = new Date()) => guarded(() => holdCall(seat, callId, now));
export const resume = (seat: DdsSeat, callId: string, now = new Date()) => guarded(() => resumeCall(seat, callId, now));
