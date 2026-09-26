/**
 * The phone of the ДДС place, text mode. Statuses come from the phone (#691), both ways:
 *   — the crew leader calls in with a report when the crew reaches a stage (BRIGADE_IN, rings 25 s);
 *   — the dispatcher calls the crew, the applicant (#739–740) or another service from the card.
 * Every line is kept in Call.messages; crew reports are also kept in Call.counterpart.reports so the
 * review can check that the matching status was set in time.
 */
import type { Call, CallKind, Prisma, ServiceStatus } from "@prisma/client";
import { chat, type ChatMessage } from "@/lib/ai/provider";
import { db } from "@/lib/db";
import type { CallerPersona, IncidentAddress, IncidentCaller } from "@/lib/incident/types";
import type { LessonSettings } from "@/lib/lessons/settings";
import { crewPlanFor, crewSchedule, dispatchOf, stageAt, type Dispatch } from "./crew";
import { addressShort } from "./format";
import {
  callerGreeting,
  callerMockReply,
  callerPrompt,
  crewByNumber,
  crewGreeting,
  crewMockReply,
  crewNumberOf,
  crewPrompt,
  crewRoster,
  mentionsCardNumber,
  OPERATOR_112,
  operatorGreeting,
  operatorMockReply,
  operatorPrompt,
  reportLine,
  serviceGreeting,
  serviceMockReply,
  servicePhone,
  servicePrompt,
  type CrewContext,
  type CrewMember,
} from "./personas";
import { personaOf, referenceFor } from "./scenario";
import { seatFeedWhere, settingsOf } from "./scope";
import type { DdsSeat } from "./seat";

type Tx = Prisma.TransactionClient;
/** What the phone needs to know about the place. */
type PhoneSeat = Pick<DdsSeat, "id" | "lessonId" | "serviceId" | "service" | "lesson">;

/** An unanswered incoming call is lost after this many seconds. */
export const RING_SEC = 25;

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

type CrewState = { dispatch: Dispatch | null; stage: ServiceStatus | null; ctxFor: (member: CrewMember) => CrewContext };

function crewState(seat: PhoneSeat, incident: CallIncident, calls: Pick<Call, "counterpart">[], settings: LessonSettings, now: Date): CrewState {
  const own = incident.services.find((p) => p.serviceId === seat.serviceId);
  const dispatch = own ? dispatchOf(own.events, phoneDispatches(calls, incident.id)) : null;
  const ref = seat.service ? referenceFor(incident.scenario?.ddsReference, seat.service) : null;
  const { chain, plan } = crewPlanFor(ref);
  let stage = dispatch ? stageAt(crewSchedule(chain, settings.workSec), (now.getTime() - dispatch.at.getTime()) / 1000) : null;
  // Once the dispatcher closed the plate the crew is done as well.
  if (dispatch && own && (own.status === "FINISHED" || own.status === "REFUSED")) stage = own.status;
  const address = addressShort(incident.address as IncidentAddress | null);
  return {
    dispatch,
    stage,
    ctxFor: (member) => ({
      crew: member.crew,
      leader: member.leader,
      title: member.title,
      address,
      what: incident.description ?? incident.scenario?.title ?? "",
      plan,
      dispatched: dispatch?.crew === member.crew,
      stage: dispatch?.crew === member.crew ? stage : null,
    }),
  };
}

function callerPersona(incident: CallIncident): CallerPersona {
  const persona = incident.scenario ? personaOf(incident.scenario) : null;
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
  if (!settings.brigadeReports || !seat.serviceId || !seat.service) return;

  const open = await tx.incident.findMany({
    where: {
      AND: [seatFeedWhere(seat), { services: { some: { serviceId: seat.serviceId, status: { in: ["ACCEPTED", "STARTED", "ARRIVED", "WORKING"] } } } }],
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
    if (mine.some((c) => c.status === "RINGING" || c.status === "ACTIVE")) continue;
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
  /** Voice of the counterpart for speech synthesis. */
  voice: "male" | "female";
  startedAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  messages: CallMessage[];
};

export type BookEntry = { group: string; name: string; role: string; phone: string; incidentId?: string };

export type PhoneState = { current: CallBrief | null; ringing: CallBrief[]; log: CallBrief[]; book: BookEntry[]; crews: CrewMember[] };

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
    phone: c.phone ?? null,
    voice: c.voice ?? (c.kind === "crew" ? "male" : "female"),
    startedAt: call.startedAt.toISOString(),
    answeredAt: call.answeredAt?.toISOString() ?? null,
    endedAt: call.endedAt?.toISOString() ?? null,
    messages: msgs(call),
  };
}

export async function phoneState(seat: DdsSeat): Promise<PhoneState> {
  const calls = await db.call.findMany({
    where: { seatId: seat.id },
    orderBy: { startedAt: "desc" },
    take: 40,
    include: { incident: { select: { number: true } } },
  });
  const briefs = calls.map(brief);
  return {
    current: briefs.find((c) => c.status === "ACTIVE") ?? null,
    ringing: briefs.filter((c) => c.status === "RINGING"),
    log: briefs,
    book: await phoneBook(seat),
    crews: seat.service ? crewRoster(seat.service) : [],
  };
}

/** The place's phone book: its crews, and for every open card the applicant, the other services and contacts. */
export async function phoneBook(seat: DdsSeat): Promise<BookEntry[]> {
  const entries: BookEntry[] = [];
  if (seat.service) {
    for (const c of crewRoster(seat.service)) {
      entries.push({ group: `Наряды: ${seat.service.shortName}`, name: `Наряд ${c.crew} — ${c.title}`, role: `старший ${c.leader}`, phone: c.phone });
    }
  }
  if (!seat.serviceId) return entries;
  const recent = new Date(Date.now() - 30 * 60_000);
  const incidents = await db.incident.findMany({
    where: {
      AND: [
        seatFeedWhere(seat),
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
  return db.incident.findMany({ where: seatFeedWhere(seat), include: incidentInclude, orderBy: { createdAt: "desc" }, take: 40 });
}

async function reload(id: string): Promise<CallBrief> {
  const call = await db.call.findUniqueOrThrow({ where: { id }, include: { incident: { select: { number: true } } } });
  return brief(call);
}

/** Dial a number from the card, the phone book or the keypad. */
export async function dial(seat: DdsSeat, number: string, incidentId?: string | null, now = new Date()): Promise<CallResult> {
  if (seat.lesson.status !== "RUNNING") return fail("Занятие завершено", 409);
  if (!seat.service) return fail("У места не выбрана служба", 409);
  if (await db.call.findFirst({ where: { seatId: seat.id, status: "ACTIVE" }, select: { id: true } })) return fail(BUSY, 409);
  const typed = number.trim();
  const digits = normPhone(typed);
  if (!digits) return fail("Наберите номер");

  const settings = settingsOf(seat.lesson.settings);
  const incidents = await feedIncidents(seat);
  const context = incidentId ? incidents.find((i) => i.id === incidentId) : undefined;
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
    const ctx = where ? crewState(seat, where, calls.filter((c) => c.incidentId === where.id), settings, now).ctxFor(member) : null;
    const counterpart: Counterpart = {
      kind: "crew",
      crew: member.crew,
      name: member.leader,
      role: `старший наряда ${member.crew}`,
      phone: member.phone,
      voice: member.voice,
    };
    const greeting = ctx ? crewGreeting(ctx) : `Наряд ${member.crew}, ${member.leader.split(" ")[0]}. Мы на базе, свободны. Куда выезжать?`;
    return startCall(seat, "BRIGADE_OUT", where?.id ?? null, counterpart, greeting, now);
  }

  // The applicant of a card.
  const byCaller = ordered.find((i) => {
    const c = (i.caller as IncidentCaller | null) ?? {};
    return [c.aon, c.provided, c.onSite].some((p) => p && normPhone(p) === digits);
  });
  if (byCaller) {
    const persona = callerPersona(byCaller);
    const counterpart: Counterpart = { kind: "caller", name: persona.fullName, role: persona.role, phone: typed, voice: persona.voice };
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

/** One line per place: taking the handset (dialling or answering) is serialised by this lock. */
async function lockLine(tx: Prisma.TransactionClient, seatId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dds-line:${seatId}`}))`;
  return !!(await tx.call.findFirst({ where: { seatId, status: "ACTIVE" }, select: { id: true } }));
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
        messages: [{ role: "counterpart", text: greeting, at: now.toISOString() }],
        startedAt: now,
        answeredAt: now,
      },
    });
    return call.id;
  });
  if (!id) return fail(BUSY, 409);
  return { ok: true, call: await reload(id) };
}

async function ownCall(seat: DdsSeat, callId: string) {
  return db.call.findFirst({ where: { id: callId, seatId: seat.id } });
}

async function incidentFor(seat: DdsSeat, incidentId: string | null): Promise<CallIncident | null> {
  if (!incidentId) return null;
  return db.incident.findFirst({ where: { AND: [{ id: incidentId }, seatFeedWhere(seat)] }, include: incidentInclude });
}

/** Pick up an incoming call: the crew leader speaks first with the report. */
export async function answer(seat: DdsSeat, callId: string, now = new Date()): Promise<CallResult> {
  const call = await ownCall(seat, callId);
  if (!call) return fail("Звонок не найден", 404);
  if (call.status !== "RINGING") return fail("Звонок уже завершён", 409);
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
        messages: [...msgs(call), { role: "counterpart", text, at: now.toISOString() }],
      },
    });
    return moved.count ? null : "Звонок уже завершён";
  });
  if (result) return fail(result, 409);
  return { ok: true, call: await reload(call.id) };
}

/** Say a line in the current call and get the answer (model, or the offline lines). */
export async function say(seat: DdsSeat, callId: string, text: string, now = new Date()): Promise<CallResult> {
  const call = await ownCall(seat, callId);
  if (!call) return fail("Звонок не найден", 404);
  if (call.status !== "ACTIVE") return fail("Разговор уже завершён", 409);
  const line = text.trim().replace(/\s+/g, " ").slice(0, 600);
  if (!line) return fail("Пустая реплика");

  const c: Counterpart = { ...cp(call) };
  const history = msgs(call);
  const turn = history.filter((m) => m.role === "trainee").length + 1;
  const incident = await incidentFor(seat, call.incidentId);
  const settings = settingsOf(seat.lesson.settings);

  let prompt: string;
  let fallback: string;
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
    if (reply.reported) c.reports = [...(c.reports ?? []), { status: reply.reported, at: now.toISOString() }];
    prompt = crewPrompt(ctx);
    fallback = reply.text;
  } else if (c.kind === "operator112") {
    prompt = operatorPrompt(seat.service?.shortName ?? "");
    fallback = operatorMockReply(line, turn);
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

  const answerText = await speakAs(prompt, history, line, fallback);
  const said: CallMessage[] = [
    { role: "trainee", text: line, at: now.toISOString() },
    { role: "counterpart", text: answerText, at: new Date().toISOString() },
  ];
  // The model may take seconds: append to the call as it is now, and only while it is still going.
  const before = cp(call);
  const newReports = (c.reports ?? []).slice((before.reports ?? []).length);
  const saved = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dds-call:${call.id}`}))`;
    const fresh = await tx.call.findUnique({ where: { id: call.id } });
    if (!fresh || fresh.status !== "ACTIVE") return false;
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
    return true;
  });
  if (!saved) return fail("Разговор уже завершён", 409);
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

/** Put the handset down: an active call ends, a ringing one is declined and counts as missed. */
export async function hangUp(seat: DdsSeat, callId: string, now = new Date()): Promise<CallResult> {
  const call = await ownCall(seat, callId);
  if (!call) return fail("Звонок не найден", 404);
  // Conditional steps: a call answered a moment ago must not turn into a missed one.
  const ended = await db.call.updateMany({ where: { id: call.id, status: "ACTIVE" }, data: { status: "ENDED", endedAt: now } });
  if (!ended.count) await db.call.updateMany({ where: { id: call.id, status: "RINGING" }, data: { status: "MISSED", endedAt: now } });
  return { ok: true, call: await reload(call.id) };
}
