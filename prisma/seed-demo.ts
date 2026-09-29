/**
 * Demo lessons for the teacher cabinet, built on the real ticket scenarios and services (run `pnpm db:seed` first — it
 * loads them): six finished lessons of «Учебная группа № 1» over two weeks with attempts of both kinds (112 and ДДС) —
 * the last one partly waiting for review, one dealt adaptively by the students' levels — plus a draft lesson ready to
 * start. Every started lesson gets the forecast snapshot it would have got at its start (src/lib/adaptive), computed by
 * the same code from the attempts confirmed before that moment, so «прогноз ↔ факт» has real pairs to compare.
 *
 *   pnpm db:seed-demo            finished lessons + draft (reads .env, like the other db:* commands)
 *   pnpm db:seed-demo --live     also a running lesson with timers relative to now
 *
 * A demo lesson is played the way a real one goes, through the application's own code: a ДДС place gets its generated
 * cards from the card flow (flow/dds-flow.ts createCard — on its territory, moved there as in a live lesson), a 112
 * student talks to the rule-based caller (op112/caller.ts) and the card is resolved by the workstation's panels and
 * routing, the crews report by their schedule (dds/crew.ts), the other services' plates move as the bots move them. What
 * a student does comes from a profile (quick or slow, careful or sloppy); what is right and wrong comes from the current
 * checks — evaluateOp112Rules and evaluateDdsPlate, the same set and the same words as a live attempt. The model checks
 * get a recorded answer run through the same code as a live model answer (op112AiFromReply, clarityFromReply).
 *
 * Idempotent: the demo lessons are deleted and rebuilt. Reference data is only read, never written.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Incident, IncidentService, Prisma, Scenario, Service, ServiceStatus } from "@prisma/client";
import { db } from "../src/lib/db";
import { loadRatingAttempts } from "../src/lib/adaptive/levels";
import { pickAdaptive } from "../src/lib/adaptive/pick";
import { computeRating } from "../src/lib/adaptive/rating";
import { saveLessonForecasts } from "../src/lib/adaptive/snapshot";
import { botActor, botPlan, dueSteps } from "../src/lib/dds/bots";
import { correctedCard, fixLabel } from "../src/lib/dds/card-fix";
import { clarityBasis, clarityFromReply } from "../src/lib/dds/clarity-ai";
import { commentIssues } from "../src/lib/dds/clarity";
import { CREW_PACE_SEC, crewPlanFor, crewSchedule } from "../src/lib/dds/crew";
import { evaluateDdsPlate, summarize } from "../src/lib/dds/evaluate";
import { addressShort, fmtHM, shortName } from "../src/lib/dds/format";
import { crewGreeting, crewRoster, OPERATOR_112, operatorGreeting, operatorMockReply, reportLine, type CrewContext } from "../src/lib/dds/personas";
import { PLACE_REVIEW, plateReviewInput } from "../src/lib/dds/review";
import { cardErrorFrom, type DdsReferenceEntry } from "../src/lib/dds/scenario";
import { SYSTEM_ACTOR } from "../src/lib/dds/scope";
import { isLate } from "../src/lib/dds/status";
import { cardReference, territoryOf } from "../src/lib/dds/territory";
import { botFacts, byTerritory, createCard, onTerritory } from "../src/lib/flow/dds-flow";
import type { IncidentAddress, IncidentFlags } from "../src/lib/incident/types";
import { genderOfName, mockOpening, mockReply, type Persona } from "../src/lib/op112/caller";
import { findKind, kindTitle } from "../src/lib/op112/catalog";
import { dutyGreeting, dutyMockReply, dutyOf } from "../src/lib/op112/duty";
import { evaluateOp112Rules, normalizeTruth, op112AiFromReply } from "../src/lib/op112/evaluate";
import { factCards, normalizeQuestion, questionTopics, statusOfRole } from "../src/lib/op112/facts";
import { resolveDraft, routeDraft, treesFor } from "../src/lib/op112/panels";
import { channelOf } from "../src/lib/op112/phone";
import { dutyContextOf } from "../src/lib/op112/phone-calls";
import { answersForLeaf, toldAnswers, type Told } from "../src/lib/op112/reference-card";
import { loadEvalInput } from "../src/lib/op112/review";
import { mergeManual } from "../src/lib/op112/routing";
import { operatorNumber } from "../src/lib/op112/seat";
import { serviceCatalog } from "../src/lib/op112/services";
import type { CallLine, StoredTag } from "../src/lib/op112/types";
import { dutyTitle } from "../src/lib/op112/workoffs";
import { buildPublishedFeedback } from "../src/lib/review/published-feedback";
import { computeScore, type CriterionResult, type Weights } from "../src/lib/scoring/score";
import { normalizeWeights } from "../src/lib/scoring/weight-config";
import { sayable } from "../src/lib/speech/sayable";
import { DEFAULT_DDS, DEMO_PLANS, type SeatPlan } from "./demo-plan";
import { isEntry } from "./entry";
import { seedDemoMaterials } from "./seed-materials";

// ─── deterministic randomness ────────────────────────────────────────────────
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rnd = prng(20260929);
const between = (lo: number, hi: number) => Math.round(lo + rnd() * (hi - lo));
const chance = (p: number) => rnd() < p;
const oneOf = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)];
const at = (base: Date, sec: number) => new Date(base.getTime() + sec * 1000);

/**
 * Critical slips (a refused profile card, a look-alike street) come from their own stream and a budget per student over
 * the course, so a strong student does not lose a card to bad luck and a weak one does not lose every card.
 */
const CRITICAL_BUDGET: Record<string, number> = { student1: 0, student2: 1, student3: 3, student4: 2, student5: 2 };
let rare = prng(7);
const criticalSpent = new Map<string, number>();
function criticalSlip(login: string, p: number): boolean {
  if ((criticalSpent.get(login) ?? 0) >= (CRITICAL_BUDGET[login] ?? 1) || rare() >= p) return false;
  criticalSpent.set(login, (criticalSpent.get(login) ?? 0) + 1);
  return true;
}
const secBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 1000;
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const json = (v: unknown) => v as Prisma.InputJsonValue;

// ─── the class: who is quick, who is careful ─────────────────────────────────
type Profile = {
  /** ДДС: «Добавлена» → the card opened, and the opening → the first record, seconds. */
  ack: [number, number];
  record: [number, number];
  /** A crew report is picked up in time; a missed one is called back. */
  answerCall: number;
  callBack: number;
  /** A status without waiting for the report; a stage skipped; a status without a text. */
  ahead: number;
  skipStatus: number;
  bareStatus: number;
  /** Short or private comments («отпр бр», «Сделано»); a refusal without whom it was passed to. */
  sloppy: number;
  noHandover: number;
  /** The opposite decision to the reference. */
  wrongDecision: number;
  /** An error in the card reported to 112. */
  call112: number;
  /** 112: typing time, a look-alike street, a detail of the address left out, a question not asked, a told fact not put on the card. */
  typing: [number, number];
  lookAlike: number;
  missDetail: number;
  missQuestion: number;
  missFact: number;
  /** A service working by phone not called from the work-off row. */
  noPhoneCall: number;
};

const PROFILES: Record<string, Profile> = {
  student1: { ack: [6, 16], record: [8, 20], answerCall: 0.95, callBack: 0.9, ahead: 0.02, skipStatus: 0.03, bareStatus: 0, sloppy: 0.03, noHandover: 0, wrongDecision: 0, call112: 0.9, typing: [44, 62], lookAlike: 0, missDetail: 0.05, missQuestion: 0.05, missFact: 0.03, noPhoneCall: 0.05 },
  student2: { ack: [9, 24], record: [12, 34], answerCall: 0.88, callBack: 0.7, ahead: 0.06, skipStatus: 0.12, bareStatus: 0.05, sloppy: 0.12, noHandover: 0.15, wrongDecision: 0.03, call112: 0.7, typing: [52, 74], lookAlike: 0.03, missDetail: 0.15, missQuestion: 0.12, missFact: 0.1, noPhoneCall: 0.15 },
  student3: { ack: [18, 48], record: [25, 90], answerCall: 0.65, callBack: 0.35, ahead: 0.15, skipStatus: 0.35, bareStatus: 0.2, sloppy: 0.4, noHandover: 0.45, wrongDecision: 0.12, call112: 0.3, typing: [66, 104], lookAlike: 0.3, missDetail: 0.4, missQuestion: 0.35, missFact: 0.3, noPhoneCall: 0.45 },
  student4: { ack: [8, 26], record: [10, 40], answerCall: 0.8, callBack: 0.5, ahead: 0.25, skipStatus: 0.2, bareStatus: 0.1, sloppy: 0.2, noHandover: 0.6, wrongDecision: 0.1, call112: 0.5, typing: [50, 78], lookAlike: 0.08, missDetail: 0.25, missQuestion: 0.25, missFact: 0.2, noPhoneCall: 0.3 },
  student5: { ack: [22, 60], record: [30, 110], answerCall: 0.7, callBack: 0.5, ahead: 0.05, skipStatus: 0.3, bareStatus: 0.1, sloppy: 0.3, noHandover: 0.35, wrongDecision: 0.07, call112: 0.45, typing: [62, 96], lookAlike: 0.12, missDetail: 0.3, missQuestion: 0.3, missFact: 0.25, noPhoneCall: 0.35 },
};

/**
 * How the students change over the course: every lesson the chances of each slip shrink by `learn` (student4 rushes
 * more and slips a little), and a harder scenario has more traps: ×1.2 per step of difficulty above 3. Times shrink a
 * little with skill and grow a little with difficulty.
 */
const LEARN: Record<string, number> = { student1: 0.03, student2: 0.08, student3: 0.14, student4: -0.03, student5: 0.07 };

function profileFor(login: string, lessonNo: number, difficulty: number): Profile {
  const base = PROFILES[login] ?? PROFILES.student2;
  const skill = (1 - (LEARN[login] ?? 0.05)) ** lessonNo;
  const traps = 1.2 ** (difficulty - 3);
  const slip = (x: number) => Math.min(0.9, x * skill * traps);
  const good = (x: number) => Math.max(0.05, Math.min(0.99, 1 - (1 - x) * skill * traps));
  const time = ([lo, hi]: [number, number]): [number, number] => {
    const k = (0.8 + 0.2 * Math.min(1.2, skill)) * (0.94 + 0.02 * difficulty);
    return [Math.round(lo * k), Math.round(hi * k)];
  };
  return {
    ack: time(base.ack),
    record: time(base.record),
    answerCall: good(base.answerCall),
    callBack: good(base.callBack),
    ahead: slip(base.ahead),
    skipStatus: slip(base.skipStatus),
    bareStatus: slip(base.bareStatus),
    sloppy: slip(base.sloppy),
    noHandover: slip(base.noHandover),
    wrongDecision: slip(base.wrongDecision),
    call112: good(base.call112),
    typing: time(base.typing),
    lookAlike: slip(base.lookAlike),
    missDetail: slip(base.missDetail),
    missQuestion: slip(base.missQuestion),
    missFact: slip(base.missFact),
    noPhoneCall: slip(base.noPhoneCall),
  };
}

// ─── lesson context ──────────────────────────────────────────────────────────
type Review = "CONFIRMED" | "OVERRIDDEN" | "PENDING";
type ScenarioRow = Scenario;
type SeatRow = { id: string; lessonId: string; serviceId: number | null; studentId: string; login: string; fullName: string; role: "OP112" | "DDS"; label: string };
type Made = { id: string; createdAt: Date; slip: string | null };

type Ctx = {
  weights: Weights;
  teacherId: string;
  services: Map<number, Service>;
  byRef: Map<string, ScenarioRow>;
};

type LessonRun = {
  id: string;
  start: Date;
  end: Date;
  lessonNo: number;
  settings: Record<string, unknown>;
  seats: SeatRow[];
  attempts: Made[];
  /** Crews busy on the cards of a place: the next card gets a free one. */
  crewTurn: Map<string, number>;
};

// ─── 112: the call and the card ──────────────────────────────────────────────

/** What the operator asks about a topic of a required question, in the words a trainee uses. */
const ASK: Record<string, string> = {
  victims: "Есть пострадавшие? Кому-нибудь нужна медицинская помощь?",
  gas: "Дом газифицирован? Газ магистральный или баллон?",
  floors: "Сколько этажей в доме и на каком этаже?",
  people: "Сколько человек там? Сколько людей в опасности?",
  threat: "Есть угроза людям, огонь может перекинуться?",
  access: "Есть доступ, можно проехать к месту?",
  age: "Сколько лет пострадавшему?",
  consciousness: "Он в сознании, реагирует на вас?",
  breathing: "Он дышит?",
  weapon: "У них есть оружие — нож, бита?",
  object: "Опишите приметы: как выглядит, какая машина, номер?",
  fire: "Открытый огонь или только дым?",
  what: "Что именно произошло?",
};

/** A known look-alike of a street for the critical address slip. */
const confusable = (() => {
  try {
    const raw = JSON.parse(readFileSync(path.join(__dirname, "..", "data", "confusable-streets.json"), "utf8")) as { pairs?: { a: string; b: string }[] };
    return raw.pairs ?? [];
  } catch {
    return [];
  }
})();
function lookAlike(street: string): string | null {
  const low = street.toLowerCase().replace(/ё/g, "е");
  const name = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/^(ул\.|улица)\s*|\s*(ул\.|улица)$/g, "").trim();
  const pair = confusable.find((p) => name(p.a) === name(low) || name(p.b) === name(low));
  return pair ? (name(pair.a) === name(low) ? pair.b : pair.a) : null;
}

type Card112 = { incident: Incident; plates: IncidentService[]; savedAt: Date; sloppy: boolean };

async function play112(run: LessonRun, seat: SeatRow, scenario: ScenarioRow, t0: Date, p: Profile, ctx: Ctx): Promise<Card112 | null> {
  const persona = scenario.caller as unknown as Persona | null;
  const catalog = await serviceCatalog();
  const truth = normalizeTruth(scenario.truth, catalog);
  if (!persona?.situation || !truth?.kind || !truth.typeCodes.length) return null;
  const answeredAt = at(t0, between(3, 8));
  const gender = genderOfName(seat.fullName);

  // The conversation: the operator's questions, the caller's rule-based answers with what each line disclosed.
  const lines: CallLine[] = [{ role: "counterpart", ...mockOpening(persona), at: answeredAt.toISOString() }];
  let clock = answeredAt;
  const say = (text: string) => {
    clock = at(clock, between(5, 11));
    const history = [...lines];
    lines.push({ role: "trainee", text, at: clock.toISOString() });
    clock = at(clock, between(3, 7));
    const reply = mockReply(persona, history, text, gender);
    lines.push({ role: "counterpart", text: reply.text, revealed: reply.revealed, at: clock.toISOString() });
  };
  say("Служба 112, что у вас случилось?");
  say("Назовите адрес: улица и номер дома.");
  const skipExact = chance(p.missDetail);
  if (persona.hiddenAddress && !skipExact) say("Уточните, пожалуйста: номер дома, корпус, подъезд — что рядом?");
  for (const q of truth.requiredQuestions.map(normalizeQuestion)) {
    const topics = questionTopics(q.text).filter((t) => !["address", "addressExact", "name", "status", "phone"].includes(t));
    if (!topics.length && q.topic && ["address", "addressExact", "name", "status", "phone"].includes(q.topic)) continue;
    if (chance(p.missQuestion)) continue;
    say(topics.length ? topics.map((t) => ASK[t] ?? `Уточните: ${q.text.toLowerCase()}?`).join(" ") : `Уточните: ${q.text.charAt(0).toLowerCase()}${q.text.slice(1)}?`);
  }
  const askName = !chance(p.missQuestion / 2);
  if (askName) say("Как вас зовут? Фамилия и имя.");
  if (!chance(p.missQuestion)) say("Кем вы приходитесь — вы очевидец?");
  const askPhone = !chance(p.missQuestion / 2);
  if (askPhone) say("Назовите номер телефона для связи.");
  say("Информация принята, помощь направлена. Оставайтесь на связи.");

  // What the caller said, as the card holds it.
  const facts = factCards(persona);
  const said = new Set(lines.flatMap((l) => l.revealed ?? []));
  const told: Told = { flags: { ...truth.flags } };
  for (const f of facts.filter((c) => said.has(c.key))) {
    const e = f.expect;
    if (chance(p.missFact)) continue;
    if (e?.kind === "flag") told.flags[e.flag] = e.value;
    if (e?.kind === "tag" && /этажн/i.test(e.row)) told.floors = e.value;
    if (e?.kind === "tag" && /газ магистральный/i.test(e.row)) told.gasSource = e.value as Told["gasSource"];
  }
  // A careless operator leaves a row of the reference unanswered.
  for (const key of Object.keys(told.flags) as (keyof IncidentFlags)[]) if (chance(p.missFact / 2)) delete told.flags[key];

  const kind = findKind(truth.kind)?.name ?? truth.kind;
  const tree = (await treesFor([kind]))[kind];
  const leaf = truth.typeCodes[0];
  const answers = toldAnswers(tree, answersForLeaf(tree, leaf) ?? {}, told);

  const street = truth.address.street;
  const wrongStreet = street && lookAlike(street) && criticalSlip(seat.login, p.lookAlike) ? lookAlike(street) : null;
  const address: IncidentAddress = { ...truth.address, ...(wrongStreet ? { street: wrongStreet } : {}) };
  if (skipExact || chance(p.missDetail)) for (const k of ["flat", "entrance", "code"] as const) delete address[k];
  const sloppy = chance(p.sloppy);
  const reference = (scenario.ddsCard as { description?: string } | null)?.description ?? persona.situation;
  // What the caller told beyond the reference text (age, consciousness, how many people) goes to the description too.
  const extra = facts.filter((f) => said.has(f.key) && f.expect?.kind === "description" && !chance(p.missFact)).map((f) => f.text.replace(/[.\s]+$/, ""));
  const description = sloppy
    ? reference.split(/[,.]/)[0].toLowerCase().replace(/\s+/g, " ").slice(0, 38)
    : [reference.replace(/[.\s]+$/, ""), ...extra].join(". ") + ".";
  const top: IncidentFlags = { victims: told.flags.victims, refusedAmbulance: told.flags.refusedAmbulance, noAccess: told.flags.noAccess };
  const draft = { cards: [kind], answers: { [kind]: answers }, flags: top, address };
  const resolved = await resolveDraft(draft);
  const routed = mergeManual(await routeDraft(draft, resolved), [], catalog);

  const savedAt = at(answeredAt, between(p.typing[0], p.typing[1]));
  const operatorNo = operatorNumber(seat.login);
  const [surname, name] = persona.fullName.split(/\s+/);
  const callerStatus = statusOfRole(persona.role) ?? truth.callerStatus ?? "очевидец";
  const incident = await db.incident.create({
    data: {
      lessonId: run.id,
      scenarioId: scenario.id,
      source: "op112",
      createdBySeatId: seat.id,
      operatorNo,
      armNo: seat.label.match(/\d+/)?.[0] ?? "1",
      status: "registered",
      caller: json({
        aon: persona.phone ?? "",
        channel: channelOf(persona.phone ?? ""),
        ...(askName ? { fullName: `${surname} ${name ?? ""}`.trim() } : {}),
        status: callerStatus,
        ...(askPhone && persona.phone ? { provided: persona.phone } : {}),
      }),
      address: json(address),
      flags: json(resolved.flags),
      tags: json(resolved.tags as StoredTag[]),
      typeCodes: resolved.typeCodes,
      description,
      descriptionLog: json([{ at: savedAt.toISOString(), author: `оп. ${operatorNo}`, text: description }]),
      openedAt: answeredAt,
      savedAt,
      createdAt: answeredAt,
      services: {
        create: routed.map((r) => ({
          serviceId: r.serviceId,
          isMain: r.isMain,
          addedBy: r.auto ? "auto" : "manual",
          status: "ADDED" as const,
          addedAt: savedAt,
          events: { create: { status: "ADDED" as const, actorLabel: SYSTEM_ACTOR, at: savedAt } },
        })),
      },
    },
    include: { services: true },
  });
  await db.call.create({
    data: {
      lessonId: run.id,
      seatId: seat.id,
      incidentId: incident.id,
      kind: "CALLER_IN",
      status: "ENDED",
      counterpart: json({ name: persona.fullName, role: persona.role, voice: persona.voice ?? "female", phone: persona.phone, scenarioId: scenario.id, persona }),
      messages: json(lines),
      startedAt: t0,
      answeredAt,
      endedAt: savedAt,
    },
  });

  // «Добавить отработку»: the services working by phone are called from the work-off row and written down.
  let workedAt = at(savedAt, between(15, 40));
  const workLog: Record<string, unknown>[] = [];
  for (const plate of incident.services) {
    const service = ctx.services.get(plate.serviceId);
    if (service?.delivery !== "PHONE" || chance(p.noPhoneCall)) continue;
    const { duty, voice } = dutyOf(service.id, incident.number);
    const cp = { kind: "service" as const, serviceId: service.id, service: service.shortName, fullName: service.fullName ?? null, duty, voice, phone: "" };
    const dctx = await dutyContextOf(incident, cp);
    const callAt = at(workedAt, between(5, 20));
    const greeting: CallLine = { role: "counterpart", text: dutyGreeting(dctx), at: callAt.toISOString(), revealed: [] };
    const text = `Служба 112, примите карточку ${incident.number}: ${kindTitle(kind).toLowerCase()}, ${address.street ?? ""}${address.house ? `, дом ${address.house}` : ""}.`;
    const said: CallLine = { role: "trainee", text, at: at(callAt, 6).toISOString() };
    const reply = dutyMockReply(dctx, [greeting], text);
    const answer: CallLine = { role: "counterpart", text: reply.text, at: at(callAt, 9).toISOString(), revealed: [], ...(reply.accepted ? { accepted: true } : {}) };
    const call = await db.call.create({
      data: {
        lessonId: run.id,
        seatId: seat.id,
        incidentId: incident.id,
        kind: "SERVICE_OUT",
        status: "ENDED",
        counterpart: json({ ...cp, name: `${service.shortName}, ${dutyTitle(duty)}` }),
        messages: json([greeting, said, answer]),
        startedAt: callAt,
        answeredAt: callAt,
        endedAt: at(callAt, 14),
      },
    });
    workedAt = at(callAt, between(25, 45));
    workLog.push({ id: randomUUID(), at: workedAt.toISOString(), operator: operatorNo, arm: incident.armNo ?? "", serviceId: service.id, service: service.shortName, acceptedBy: dutyTitle(duty), summary: "Карточка принята по телефону", callId: call.id });
  }
  const saved = await db.incident.update({ where: { id: incident.id }, data: { status: "worked", workedAt, workLog: json(workLog) }, include: { services: true } });
  return { incident: saved, plates: saved.services, savedAt, sloppy };
}

/** The 112 attempt: the current rule checks of the card, and the model's two checks from a recorded answer. */
async function grade112(run: LessonRun, seat: SeatRow, card: Card112, ctx: Ctx) {
  const loaded = await loadEvalInput(card.incident.id);
  if (!loaded) return;
  const rules = evaluateOp112Rules(loaded.input);
  // The model agrees with the rules most of the time; now and then it is too strict or too lenient on the description —
  // that is what the teacher corrects («ИИ неправ»).
  const slip = chance(0.1);
  const clear = slip ? card.sloppy : !card.sloppy;
  const ai = op112AiFromReply(loaded.input, rules, {
    discrepancies: [],
    descriptionClear: clear,
    descriptionComment: clear
      ? "Понятно, что случилось, где и есть ли угроза людям."
      : card.sloppy
        ? "Описание обрывается: не сказано, что именно случилось и есть ли угроза людям."
        : "Описание длинное, главное стоит поставить в начало.",
  });
  const criteria = [...rules, ...ai];
  const created = await db.attempt.create({
    data: {
      lessonId: run.id,
      seatId: seat.id,
      studentId: seat.studentId,
      kind: "OP112",
      incidentId: card.incident.id,
      scenarioId: card.incident.scenarioId,
      criteria: json(criteria),
      score: computeScore(criteria, ctx.weights),
      createdAt: at(card.savedAt, 2),
    },
  });
  run.attempts.push({ id: created.id, createdAt: created.createdAt, slip: slip ? "op112.ai.description" : null });
}

// ─── ДДС: the place's work on its plate ──────────────────────────────────────

const ACCEPT = [
  (crew: string, title: string) => `Принята, направлен наряд ${crew} — ${title.toLowerCase()}`,
  (crew: string) => `Направлен наряд ${crew}, выезжает на место`,
  (crew: string, title: string) => `Принята. Наряд ${crew} (${title.toLowerCase()}) направлен по адресу`,
];

type PlateRun = { seat: SeatRow; incident: Incident; plate: IncidentService; addedAt: Date; p: Profile; service: Service };

async function workPlate(run: LessonRun, w: PlateRun) {
  const { seat, incident, plate, addedAt, p, service } = w;
  const ref: DdsReferenceEntry | null = cardReference((await scenarioOf(incident))?.ddsReference, service, incident.address);
  const settings = run.settings as { ackSec: number; workSec: number };
  const actor = shortName(seat.fullName);
  const events: Prisma.StatusEventCreateManyInput[] = [];
  let firstRecord = true;
  const push = (status: ServiceStatus, when: Date, comment?: string | null, crew?: string | null) => {
    if (when > run.end) return false;
    const record = !!comment && firstRecord && status !== "RECEIVED";
    if (record) firstRecord = false;
    events.push({
      incidentServiceId: plate.id,
      status,
      comment: comment ?? null,
      crewNumber: crew ?? null,
      actorLabel: status === "RECEIVED" ? SYSTEM_ACTOR : actor,
      actorUserId: status === "RECEIVED" ? null : seat.studentId,
      seatId: seat.id,
      late: status === "RECEIVED" ? isLate(addedAt, when, settings.ackSec) : record && isLate(addedAt, when, settings.workSec),
      at: when,
    });
    return true;
  };

  const openedAt = at(addedAt, between(p.ack[0], p.ack[1]));
  if (!push("RECEIVED", openedAt)) return finishPlate(plate, events);
  const answerAt = at(openedAt, between(p.record[0], p.record[1]));
  const reference = ref?.decision ?? "accept";
  const wrong = reference !== "open" && criticalSlip(seat.login, p.wrongDecision * 2);
  const decision = reference === "open" ? (chance(0.85) ? "accept" : "reject") : wrong ? (reference === "accept" ? "reject" : "accept") : reference;
  const sloppy = chance(p.sloppy);

  if (decision === "reject") {
    const good =
      ref?.decision === "reject"
        ? (ref.why ?? "Не наша зона ответственности, информация передана по принадлежности")
        : "Не принята: выезд района не требуется, на месте работают профильные службы; информация передана в ЕДДС округа";
    const comment = wrong ? (chance(0.5) ? "Не наш профиль, реагирует служба 101" : "Не наш профиль") : chance(p.noHandover) ? "Не наша территория" : good;
    push("REJECTED", answerAt, comment);
    return finishPlate(plate, events);
  }

  const roster = crewRoster(service);
  const turn = run.crewTurn.get(seat.id) ?? 0;
  run.crewTurn.set(seat.id, turn + 1);
  const member = roster[turn % roster.length];
  const bare = chance(p.bareStatus);
  const accepted = bare ? null : sloppy ? `отпр бр ${member.crew}` : oneOf(ACCEPT)(member.crew, member.title);
  if (!push("ACCEPTED", answerAt, accepted, member.crew)) return finishPlate(plate, events);

  const { chain, plan } = crewPlanFor(ref);
  const schedule = crewSchedule(chain, CREW_PACE_SEC);
  const error = ref?.cardError;
  let errorFixed = false;
  let errorTold = false;
  const address = addressShort(incident.address as IncidentAddress | null);
  let lastStatusAt = answerAt;
  for (const step of schedule) {
    const ringAt = at(answerAt, step.afterSec + between(1, 4));
    if (ringAt > run.end) break;
    const crewCtx: CrewContext = { crew: member.crew, leader: member.leader, title: member.title, address, what: incident.description ?? "", plan, dispatched: true, stage: step.status, errorTold, errorFixed };
    const counterpart = { kind: "crew", crew: member.crew, name: member.leader, role: `старший наряда ${member.crew}`, phone: member.phone, voice: member.voice, stage: step.status };
    let heardAt: Date | null = null;
    if (chance(p.answerCall)) {
      heardAt = at(ringAt, between(2, 9));
      const report = sayable(reportLine(step.status, crewCtx));
      const ack = step.status === "FINISHED" || step.status === "REFUSED" ? "Принято, закрываю карточку." : "Принято.";
      await db.call.create({
        data: {
          lessonId: run.id, seatId: seat.id, incidentId: incident.id, kind: "BRIGADE_IN", status: "ENDED",
          counterpart: json({ ...counterpart, reports: [{ status: step.status, at: heardAt.toISOString() }] }),
          messages: json([
            { role: "counterpart", text: report, at: heardAt.toISOString() },
            { role: "trainee", text: ack, at: at(heardAt, 5).toISOString() },
            { role: "counterpart", text: "Понял. Будут изменения — доложу.", at: at(heardAt, 7).toISOString() },
          ]),
          startedAt: ringAt, answeredAt: heardAt, endedAt: at(heardAt, 10),
        },
      });
    } else {
      const missedAt = new Date(Math.min(at(ringAt, 25).getTime(), run.end.getTime()));
      await db.call.create({
        data: { lessonId: run.id, seatId: seat.id, incidentId: incident.id, kind: "BRIGADE_IN", status: "MISSED", counterpart: json(counterpart), messages: json([]), startedAt: ringAt, endedAt: missedAt },
      });
      const backAt = at(missedAt, between(10, 50));
      if (chance(p.callBack) && backAt < run.end) {
        heardAt = backAt;
        await db.call.create({
          data: {
            lessonId: run.id, seatId: seat.id, incidentId: incident.id, kind: "BRIGADE_OUT", status: "ENDED",
            counterpart: json({ ...counterpart, stage: undefined, reports: [{ status: step.status, at: backAt.toISOString() }] }),
            messages: json([
              { role: "counterpart", text: sayable(crewGreeting(crewCtx, true)), at: backAt.toISOString() },
              { role: "trainee", text: "Принято, спасибо.", at: at(backAt, 5).toISOString() },
            ]),
            startedAt: backAt, answeredAt: backAt, endedAt: at(backAt, 9),
          },
        });
      }
    }
    if (heardAt && ["ARRIVED", "WORKING", "FINISHED", "REFUSED"].includes(step.status)) errorTold = true;

    // An error in the card told from the site: the careful dispatcher phones 112 with the card number and the right information.
    if (error && heardAt && step.status === "ARRIVED" && !errorFixed && chance(p.call112)) {
      const callAt = at(heardAt, between(20, 45));
      if (callAt < run.end) {
        const text = `Служба 112, ДДС ${service.shortName.replace(/^Поселение\s+/, "")}, диспетчер ${seat.fullName.split(" ")[0]}. По карточке ${incident.number} ошибка: ${error.onSite}.`;
        const label = fixLabel(error);
        await db.call.create({
          data: {
            lessonId: run.id, seatId: seat.id, incidentId: incident.id, kind: "SERVICE_OUT", status: "ENDED",
            counterpart: json({ kind: "operator112", name: OPERATOR_112, role: "оператор", phone: "112" }),
            messages: json([
              { role: "counterpart", text: operatorGreeting(), at: callAt.toISOString() },
              { role: "trainee", text, at: at(callAt, 8).toISOString() },
              { role: "counterpart", text: operatorMockReply(text, 1, { kind: "fixed", card: incident.number, label }), at: at(callAt, 12).toISOString() },
            ]),
            startedAt: callAt, answeredAt: callAt, endedAt: at(callAt, 20),
          },
        });
        const fresh = await db.incident.findUniqueOrThrow({ where: { id: incident.id }, select: { address: true, flags: true, descriptionLog: true } });
        const next = correctedCard(fresh, error, service.shortName, at(callAt, 12));
        await db.incident.update({ where: { id: incident.id }, data: { address: json(next.address), flags: json(next.flags), descriptionLog: json(next.descriptionLog) } });
        errorFixed = true;
      }
    }

    // The status by the report; skipped, guessed ahead of it, or set without a text by the less careful.
    const closing = step.status === "FINISHED" || step.status === "REFUSED";
    if (!closing && (step.status === "ARRIVED" || step.status === "WORKING") && chance(p.skipStatus)) continue;
    const ahead = !closing && chance(p.ahead);
    const when = ahead ? at(answerAt, Math.max(8, step.afterSec - between(40, 70))) : heardAt ? at(heardAt, between(6, 25)) : at(ringAt, 25 + between(20, 80));
    const setAt = new Date(Math.max(when.getTime(), lastStatusAt.getTime() + 3000));
    let comment: string;
    if (step.status === "STARTED") comment = sloppy ? "выехали" : `Наряд ${member.crew} выехал`;
    else if (step.status === "ARRIVED") comment = `Наряд ${member.crew} прибыл на место`;
    else if (step.status === "WORKING") comment = `Наряд ${member.crew}: ${plan.work ?? "работы на месте"}`;
    else if (step.status === "REFUSED") comment = sloppy ? "Отказ" : `Отказ от работ: ${plan.refuse ?? "не наша зона ответственности"}; информация передана по принадлежности`;
    else {
      const result = cap((plan.result ?? "работы выполнены").replace(/[.\s]+$/, ""));
      const right = error ? `; на месте: ${error.onSite}` : "";
      comment = sloppy ? oneOf(["Сделано", "Работы завершены"]) : `${result}${right}. Наряд ${member.crew} закончил работы в ${fmtHM(setAt)}`;
    }
    if (!push(step.status, setAt, comment, member.crew)) break;
    lastStatusAt = setAt;
  }
  return finishPlate(plate, events);
}

async function finishPlate(plate: IncidentService, events: Prisma.StatusEventCreateManyInput[]) {
  if (!events.length) return;
  await db.statusEvent.createMany({ data: events });
  const last = events[events.length - 1];
  const crew = events.find((e) => e.crewNumber)?.crewNumber ?? null;
  await db.incidentService.update({ where: { id: plate.id }, data: { status: last.status, crewNumber: crew } });
}

const scenarios = new Map<string, ScenarioRow>();
async function scenarioOf(incident: Pick<Incident, "scenarioId">) {
  return incident.scenarioId ? (scenarios.get(incident.scenarioId) ?? null) : null;
}

/** The other services on the card move as the flow's bots move them while a place of the lesson polls. */
async function moveBots(run: LessonRun, incident: Incident, plates: IncidentService[], live: Set<number>) {
  const scenario = await scenarioOf(incident);
  for (const plate of plates) {
    const service = (await db.service.findUnique({ where: { id: plate.serviceId } }))!;
    if (live.has(plate.serviceId) || service.delivery === "PHONE") continue;
    const plan = botPlan({ id: plate.id, serviceId: plate.serviceId, shortName: service.shortName, delivery: service.delivery, ...botFacts({ flags: incident.flags, address: incident.address, scenario }, service) });
    const due = dueSteps(plan, "ADDED", secBetween(plate.addedAt, run.end));
    if (!due.length) continue;
    let crew: string | null = null;
    const actor = botActor({ id: plate.id, shortName: service.shortName });
    await db.statusEvent.createMany({
      data: due.map((step) => {
        crew = step.crewNumber ?? crew;
        return { incidentServiceId: plate.id, status: step.status, comment: step.comment ?? null, crewNumber: crew, actorLabel: actor, at: at(plate.addedAt, step.afterSec) };
      }),
    });
    await db.incidentService.update({ where: { id: plate.id }, data: { status: due[due.length - 1].status, crewNumber: crew } });
  }
}

/** The ДДС attempt: the current checks of the plate, and the model's clarity check from a recorded answer. */
async function gradePlate(run: LessonRun, plate: IncidentService, ctx: Ctx) {
  const input = await plateReviewInput(plate.id, run.end);
  if (!input) return;
  const rules = evaluateDdsPlate(input.facts);
  const criteria = [...rules];
  let slip: string | null = null;
  if (input.judged.length) {
    // The model reads the comments the way the rules do; now and then it is too strict or too lenient.
    const unclear = input.judged.find((c) => commentIssues(c).length);
    slip = chance(0.1) ? "dds.ai.literacy" : null;
    const clear = slip ? !!unclear : !unclear;
    const fragment = clear ? "" : (unclear ?? input.judged[input.judged.length - 1]).text.split(/[.;]/)[0];
    const basis = clarityBasis(input.judged);
    criteria.push(clarityFromReply({ clear, fragment, better: "Полными фразами: кто выехал, что сделано, чем закончилось" }, { service: input.plate.service.shortName, card: incident112Line(input.incident), comments: input.judged, cardError: cardErrorFrom(input.incident.scenario?.ddsReference) }, [], basis));
  }
  const score = computeScore(criteria, ctx.weights);
  const created = await db.attempt.create({
    data: {
      lessonId: run.id,
      seatId: input.seat.id,
      studentId: input.seat.studentId,
      kind: "DDS",
      incidentId: input.incident.id,
      incidentServiceId: plate.id,
      scenarioId: input.incident.scenarioId,
      criteria: json(criteria),
      score,
      aiDraft: json({ summary: summarize(criteria, score), source: "rules", by: PLACE_REVIEW, final: true }),
      createdAt: new Date(Math.min(run.end.getTime(), (input.plate.events.at(-1)?.at ?? run.end).getTime() + 4000)),
    },
  });
  run.attempts.push({ id: created.id, createdAt: created.createdAt, slip });
}

const incident112Line = (i: { description: string | null }) => (i.description ?? "").slice(0, 300);

// ─── lesson builder ──────────────────────────────────────────────────────────

async function buildLesson(opts: {
  id: string;
  title: string;
  status: "FINISHED" | "DRAFT";
  start: Date;
  durationMin: number;
  plan: SeatPlan[];
  settings: Record<string, unknown>;
  review: (i: number, total: number) => Review;
  groupId: string;
  lessonNo: number;
  ctx: Ctx;
}) {
  const { ctx } = opts;
  rnd = prng(20260929 + opts.lessonNo * 7919);
  const students = await db.user.findMany({ where: { login: { in: opts.plan.map((p) => p.login) } } });
  const byLogin = new Map(students.map((s) => [s.login, s]));
  const end = at(opts.start, opts.durationMin * 60);
  await db.lesson.create({
    data: {
      id: opts.id,
      title: opts.title,
      teacherId: ctx.teacherId,
      groupId: opts.groupId,
      status: opts.status,
      settings: json(opts.settings),
      startedAt: opts.status === "DRAFT" ? null : opts.start,
      finishedAt: opts.status === "FINISHED" ? end : null,
      createdAt: at(opts.start, -3600),
    },
  });
  const serviceByName = new Map([...ctx.services.values()].map((s) => [s.shortName, s]));
  const seats: SeatRow[] = [];
  for (const [i, p] of opts.plan.entries()) {
    const student = byLogin.get(p.login);
    if (!student) continue;
    const service = p.role === "DDS" ? serviceByName.get(p.service ?? DEFAULT_DDS) : undefined;
    if (p.role === "DDS" && !service) throw new Error(`Нет службы «${p.service}» — обновите справочники (pnpm db:seed)`);
    const ids = p.tasks.map((ref) => ctx.byRef.get(ref)?.id).filter((x): x is string => !!x);
    const label = `Место ${i + 1}`;
    const seat = await db.seat.create({
      data: { lessonId: opts.id, studentId: student.id, role: p.role, serviceId: service?.id ?? null, scenarioIds: ids, label, createdAt: at(opts.start, -3600 + i) },
    });
    seats.push({ id: seat.id, lessonId: opts.id, serviceId: seat.serviceId, studentId: student.id, login: student.login, fullName: student.fullName, role: p.role, label });
  }
  if (opts.status === "DRAFT") return { attempts: 0 };

  const run: LessonRun = { id: opts.id, start: opts.start, end, lessonNo: opts.lessonNo, settings: opts.settings, seats, attempts: [], crewTurn: new Map() };
  const mixed = opts.settings.cardSource === "mixed";
  const tempo = Number(opts.settings.tempoSec ?? 90);
  const live = new Set(seats.filter((s) => s.role === "DDS").map((s) => s.serviceId!));
  const earlier = new Map(
    [...(await loadRatingAttempts(seats.map((s) => s.studentId), { client: db })).entries()].map(([id, list]) => [id, list.filter((a) => a.createdAt < opts.start)]),
  );
  const tickets = [...ctx.byRef.values()].filter((s) => s.status === "APPROVED" && s.source === "ticket" && !/-ош$/.test(s.ticketRef ?? ""));

  // A task the adaptive lesson deals by the student's level (src/lib/adaptive) — for a ДДС place, on its territory.
  const adaptiveTask = (seat: SeatRow, had: Set<string>) => {
    const level = computeRating(seat.role, earlier.get(seat.studentId) ?? []);
    let pool = tickets.filter((s) => !had.has(s.id) && (seat.role === "OP112" || s.ddsCard !== null));
    if (seat.role === "DDS") {
      const own = ctx.services.get(seat.serviceId!)!;
      const t = territoryOf(own)!;
      pool = byTerritory(pool.filter((s) => onTerritory(s, t) !== "no"), t, own);
    }
    const pick = pickAdaptive(pool.map((s) => ({ id: s.ticketRef!, difficulty: s.difficulty })), { target: level.difficulty, random: rnd });
    return pick ? ctx.byRef.get(pick.id)! : null;
  };

  // 112 places: a call every few minutes; the card goes to the ДДС places of its services when the lesson takes them.
  const toDds: { card: Card112; seat: SeatRow }[] = [];
  for (const seat of seats.filter((s) => s.role === "OP112")) {
    const plan = opts.plan.find((p) => p.login === seat.login)!;
    const had = new Set<string>();
    const count = plan.tasks.length || (plan.cards ?? 3);
    let t = at(opts.start, between(40, 90));
    for (let k = 0; k < count; k++) {
      const scenario = plan.tasks.length ? ctx.byRef.get(plan.tasks[k]) : adaptiveTask(seat, had);
      if (!scenario) continue;
      had.add(scenario.id);
      const card = await play112(run, seat, scenario, t, profileFor(seat.login, opts.lessonNo, scenario.difficulty), ctx);
      if (!card) continue;
      await grade112(run, seat, card, ctx);
      if (mixed) for (const dds of seats.filter((s) => s.role === "DDS" && card.plates.some((pl) => pl.serviceId === s.serviceId))) toDds.push({ card, seat: dds });
      t = at(card.savedAt, between(150, 330));
    }
  }

  // ДДС places: their own generated cards at the lesson's tempo, and the 112 cards of their service.
  for (const seat of seats.filter((s) => s.role === "DDS")) {
    const plan = opts.plan.find((p) => p.login === seat.login)!;
    const service = ctx.services.get(seat.serviceId!)!;
    const territory = territoryOf(service);
    const had = new Set<string>();
    const count = plan.tasks.length || (plan.cards ?? 3);
    let t = at(opts.start, between(15, 45));
    const work: PlateRun[] = [];
    for (let k = 0; k < count; k++) {
      const scenario = plan.tasks.length ? ctx.byRef.get(plan.tasks[k]) : adaptiveTask(seat, had);
      if (!scenario) continue;
      had.add(scenario.id);
      // Guard: a demo card of a district or prefecture place is always on its territory, as in a live lesson.
      if (territory && onTerritory(scenario, territory) === "no") throw new Error(`${scenario.ticketRef} не попадает на территорию «${service.shortName}»`);
      const created = await createCard(db, { id: seat.id, lessonId: run.id, serviceId: service.id }, scenario, t);
      if (!created) continue;
      const incident = await db.incident.findUniqueOrThrow({ where: { id: created.id }, include: { services: true } });
      await db.incident.update({ where: { id: incident.id }, data: { createdAt: t } });
      const own = incident.services.find((pl) => pl.serviceId === service.id)!;
      const p = profileFor(seat.login, opts.lessonNo, scenario.difficulty);
      work.push({ seat, incident, plate: own, addedAt: t, p, service });
      await moveBots(run, incident, incident.services.filter((pl) => pl.id !== own.id), new Set());
      t = at(t, tempo + between(20, 150));
    }
    for (const item of toDds.filter((x) => x.seat.id === seat.id)) {
      const own = item.card.plates.find((pl) => pl.serviceId === service.id)!;
      const scenario = await scenarioOf(item.card.incident);
      work.push({ seat, incident: item.card.incident, plate: own, addedAt: item.card.savedAt, p: profileFor(seat.login, opts.lessonNo, scenario?.difficulty ?? 3), service });
    }
    for (const w of work.sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime())) await workPlate(run, w);
  }
  // Cards typed at 112 that reached a ДДС place of the lesson: their other plates move while the places poll.
  const reached = new Map(toDds.map((x) => [x.card.incident.id, x.card]));
  for (const card of reached.values()) await moveBots(run, card.incident, card.plates, live);

  // The reviews, with the facts as they stand at the end of the lesson.
  for (const seat of seats.filter((s) => s.role === "DDS")) {
    const plates = await db.incidentService.findMany({ where: { serviceId: seat.serviceId!, events: { some: { seatId: seat.id } }, incident: { lessonId: run.id } } });
    for (const plate of plates) await gradePlate(run, plate, ctx);
  }
  await applyReviews(run, opts.review, ctx);
  return { attempts: run.attempts.length };
}

// ─── the teacher's review ────────────────────────────────────────────────────

/** What the teacher wrote when correcting a model check of the demo: pass — the model was too strict, fail — too lenient. */
const DEMO_CORRECTION: Record<string, { pass: string; fail: string }> = {
  "op112.ai.description": {
    pass: "Коротко, но суть, адрес и угроза людям есть — службе понятно. Засчитываю.",
    fail: "ИИ не заметил: из описания не понять, что случилось и есть ли угроза людям. Засчитываю как ошибку.",
  },
  "dds.ai.literacy": {
    pass: "Понятно без звонка: кто выехал, что сделано, чем закончилось. Засчитываю.",
    fail: "Не сказано, чем закончилось и кто работал, — следующему диспетчеру придётся звонить. Засчитываю как ошибку.",
  },
};

const CONFIRM_NOTES = [
  "Разобрали на занятии. Обратите внимание на ошибки ниже.",
  "Ошибки разобрали, на следующем занятии — повторить.",
  "Смотрите замечания: их разбираем в начале следующего занятия.",
];

async function applyReviews(run: LessonRun, review: (i: number, total: number) => Review, ctx: Ctx) {
  const list = [...run.attempts].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const teacher = await db.user.findUniqueOrThrow({ where: { id: ctx.teacherId }, select: { id: true, fullName: true } });
  for (const [i, made] of list.entries()) {
    if (review(i, list.length) === "PENDING") continue;
    const a = await db.attempt.findUniqueOrThrow({ where: { id: made.id }, include: { scenario: { select: { title: true, category: true, truth: true } } } });
    const criteria = a.criteria as unknown as CriterionResult[];
    const reviewedAt = at(run.end, 600 + i * 40);
    // «ИИ неправ» where the model slipped; «Верно» everywhere else.
    const slipped = made.slip ? criteria.find((c) => c.code === made.slip && c.ok !== null) : undefined;
    const override = slipped ? { [slipped.code]: !slipped.ok } : null;
    const teacherComment = slipped ? DEMO_CORRECTION[slipped.code][slipped.ok ? "fail" : "pass"] : criteria.some((c) => c.ok === false) ? oneOf(CONFIRM_NOTES) : null;
    const feedback = buildPublishedFeedback({ criteria, override, teacherComment, reviewedAt });
    await db.attempt.update({
      where: { id: a.id },
      data: {
        reviewStatus: slipped ? "OVERRIDDEN" : "CONFIRMED",
        override: override ? json(override) : undefined,
        score: computeScore(criteria, ctx.weights, override),
        teacherComment,
        reviewedById: ctx.teacherId,
        reviewedAt,
        feedback: json(feedback),
      },
    });
    if (slipped && teacherComment) {
      // Every «ИИ неправ» becomes a teacher correction (src/lib/review/corrections.ts), as on the real review screen.
      const truth = (a.scenario?.truth ?? {}) as { typeCodes?: number[] };
      const typeCode = truth.typeCodes?.[0] ?? null;
      const type = typeCode == null ? null : await db.incidentType.findUnique({ where: { code: typeCode }, select: { finalType: true, groupId: true } });
      await db.teacherCorrection.create({
        data: {
          createdAt: reviewedAt,
          attemptId: a.id,
          authorId: teacher.id,
          authorName: teacher.fullName,
          role: a.kind,
          code: slipped.code,
          title: slipped.title,
          group: slipped.group,
          source: slipped.source,
          scenarioId: a.scenarioId,
          scenarioTitle: a.scenario?.title ?? null,
          category: a.scenario?.category ?? null,
          typeCode,
          typeName: type?.finalType ?? null,
          typeGroupId: type?.groupId ?? null,
          draftOk: slipped.ok,
          draftEvidence: slipped.evidence ?? null,
          teacherOk: !slipped.ok,
          comment: teacherComment,
        },
      });
    }
  }
}

// ─── running lesson with timers relative to now ─────────────────────────────
async function buildLive(ctx: Ctx, groupId: string) {
  const start = new Date(Date.now() - 7 * 60_000);
  rnd = prng(424242);
  const students = await db.user.findMany({ where: { login: { in: ["student1", "student2", "student3", "student4", "student5"] } }, orderBy: { login: "asc" } });
  const byName = new Map([...ctx.services.values()].map((s) => [s.shortName, s]));
  const plan: { role: "OP112" | "DDS"; service?: string; task: string }[] = [
    { role: "OP112", task: "Б30-3" },
    { role: "DDS", service: "Поселение Хорошево-Мневники", task: "Б2-1" },
    { role: "DDS", service: "Поселение Мещанский", task: "Б17-1" },
    { role: "DDS", service: "Поселение Дорогомилово", task: "Б1-1" },
    { role: "OP112", task: "Б17-1" },
  ];
  await db.lesson.create({
    data: {
      id: "demo-lesson-live",
      title: "Живое занятие (демо)",
      teacherId: ctx.teacherId,
      groupId,
      status: "RUNNING",
      startedAt: start,
      settings: { categories: [], cardSource: "mixed", tempoSec: 90, maxQueue: 3, ackSec: 30, workSec: 180, typingSec: 65, hints: false, brigadeReports: true, sameCard: false },
    },
  });
  const now = Date.now();
  const ago = (sec: number) => new Date(now - sec * 1000);
  for (const [i, s] of students.entries()) {
    const p = plan[i];
    const service = p.service ? byName.get(p.service) : undefined;
    const scenario = ctx.byRef.get(p.task)!;
    const seat = await db.seat.create({
      data: { lessonId: "demo-lesson-live", studentId: s.id, role: p.role, serviceId: service?.id ?? null, scenarioIds: [scenario.id], label: `Место ${i + 1}` },
    });
    if (p.role === "OP112" && i === 0) {
      // A call in progress, the card is being typed for 48 s.
      const persona = scenario.caller as unknown as Persona;
      const draft = await db.incident.create({
        data: { lessonId: "demo-lesson-live", scenarioId: scenario.id, source: "op112", createdBySeatId: seat.id, operatorNo: operatorNumber(s.login), armNo: String(i + 1), status: "draft", caller: json({ aon: persona.phone ?? "" }), address: json({ subject: "Москва" }), openedAt: ago(48), createdAt: ago(48) },
      });
      const lines: CallLine[] = [{ role: "counterpart", ...mockOpening(persona), at: ago(48).toISOString() }];
      for (const [k, text] of ["Служба 112, что у вас случилось?", "Назовите адрес: улица и номер дома."].entries()) {
        const reply = mockReply(persona, [...lines], text, genderOfName(s.fullName));
        lines.push({ role: "trainee", text, at: ago(40 - k * 14).toISOString() }, { role: "counterpart", text: reply.text, revealed: reply.revealed, at: ago(36 - k * 14).toISOString() });
      }
      await db.call.create({
        data: { lessonId: "demo-lesson-live", seatId: seat.id, incidentId: draft.id, kind: "CALLER_IN", status: "ACTIVE", counterpart: json({ name: persona.fullName, role: persona.role, voice: persona.voice ?? "female", phone: persona.phone, scenarioId: scenario.id, persona }), messages: json(lines), startedAt: ago(52), answeredAt: ago(48) },
      });
    } else if (p.role === "DDS" && service) {
      // A card of the place's own flow: one on time with a crew, one opened without a record yet, one refused.
      const addedAgo = [95, 200, 130][i - 1] ?? 60;
      const card = await createCard(db, seat, scenario, ago(addedAgo));
      if (!card) continue;
      await db.incident.update({ where: { id: card.id }, data: { createdAt: ago(addedAgo) } });
      const own = (await db.incidentService.findFirstOrThrow({ where: { incidentId: card.id, serviceId: service.id } }));
      const actor = shortName(s.fullName);
      const events: Prisma.StatusEventCreateManyInput[] = [{ incidentServiceId: own.id, status: "RECEIVED", actorLabel: SYSTEM_ACTOR, seatId: seat.id, at: ago(addedAgo - 5) }];
      if (i === 1) events.push({ incidentServiceId: own.id, status: "ACCEPTED", comment: "Принята, направлен наряд 23 — аварийная бригада", crewNumber: "23", actorLabel: actor, actorUserId: s.id, seatId: seat.id, at: ago(addedAgo - 18) });
      if (i === 3) events.push({ incidentServiceId: own.id, status: "REJECTED", comment: "Не наша территория", actorLabel: actor, actorUserId: s.id, seatId: seat.id, at: ago(addedAgo - 26) });
      await db.statusEvent.createMany({ data: events });
      await db.incidentService.update({ where: { id: own.id }, data: { status: events[events.length - 1].status, crewNumber: i === 1 ? "23" : null } });
    }
  }
}

// ─── main ────────────────────────────────────────────────────────────────────
const TICKETS = ["Б30-3", "Б2-1", "Б31-3", "Б5-1", "Б1-1", "Б4-1", "Б17-1", "Б29-1", "Б22-1", "Б20-1", "Б5-1-ош"];

const HISTORY_IDS = ["demo-lesson-h1", "demo-lesson-h2", "demo-lesson-h3", "demo-lesson-h4"];
const DEMO_IDS = [...HISTORY_IDS, "demo-lesson-1", "demo-lesson-2", "demo-lesson-3", "demo-lesson-live"];

/** Rebuilds the demo lessons (fixed ids) from the approved ticket scenarios. */
export async function seedDemo({ live = false }: { live?: boolean } = {}) {
  const teacher = await db.user.findUnique({ where: { login: "teacher" } });
  const group = await db.group.findFirst({ where: { name: "Учебная группа № 1" } });
  const serviceRows = await db.service.findMany();
  const scenarioRows = await db.scenario.findMany({ where: { OR: [{ ticketRef: { in: TICKETS } }, { status: "APPROVED", source: "ticket", ticketRef: { not: null } }] } });
  if (!teacher || !group || !serviceRows.some((s) => s.shortName === DEFAULT_DDS) || !TICKETS.every((t) => scenarioRows.some((s) => s.ticketRef === t))) {
    throw new Error("Сначала загрузите учётки и справочники: pnpm db:seed");
  }
  // Lessons deal only approved scenarios, as the teacher would have approved them in «Сценарии».
  const drafts = scenarioRows.filter((s) => s.status !== "APPROVED").map((s) => s.ticketRef);
  if (drafts.length) throw new Error(`Сценарии ${drafts.join(", ")} не утверждены — утвердите их в «Сценариях» или обновите справочники`);
  for (const s of scenarioRows) scenarios.set(s.id, s);

  const profile = await db.weightProfile.findFirst({ where: { isActive: true } });
  const ctx: Ctx = {
    weights: normalizeWeights(profile?.weights),
    teacherId: teacher.id,
    services: new Map(serviceRows.map((s) => [s.id, s])),
    byRef: new Map(scenarioRows.map((s) => [s.ticketRef!, s])),
  };

  rare = prng(7);
  criticalSpent.clear();
  const demoAttempts = await db.attempt.findMany({ where: { lessonId: { in: DEMO_IDS } }, select: { id: true } });
  await db.teacherCorrection.deleteMany({ where: { attemptId: { in: demoAttempts.map((a) => a.id) } } });
  await db.lesson.deleteMany({ where: { id: { in: DEMO_IDS } } });

  const base = { categories: [], tempoSec: 90, maxQueue: 3, ackSec: 30, workSec: 180, typingSec: 65, hints: false, brigadeReports: true };
  const common = { groupId: group.id, ctx };
  const reviewedAll = (): Review => "CONFIRMED";

  // Two weeks of the course before the two lessons below: the history behind the levels and forecasts. Who sits where:
  // prisma/demo-plan.ts.
  const history = [
    await buildLesson({
      ...common,
      lessonNo: 0,
      id: "demo-lesson-h1",
      title: "Вводное: первый вызов и первая карточка",
      status: "FINISHED",
      start: new Date("2026-09-14T07:00:00Z"),
      durationMin: 40,
      settings: { ...base, cardSource: "generated", hints: true, sameCard: false },
      plan: DEMO_PLANS["demo-lesson-h1"],
      review: reviewedAll,
    }),
    await buildLesson({
      ...common,
      lessonNo: 1,
      id: "demo-lesson-h2",
      title: "Адрес и службы на карточке",
      status: "FINISHED",
      start: new Date("2026-09-16T07:00:00Z"),
      durationMin: 45,
      settings: { ...base, cardSource: "generated", sameCard: false },
      plan: DEMO_PLANS["demo-lesson-h2"],
      review: reviewedAll,
    }),
    await buildLesson({
      ...common,
      lessonNo: 2,
      id: "demo-lesson-h3",
      title: "Адаптивное занятие: задания по уровню",
      status: "FINISHED",
      start: new Date("2026-09-18T07:00:00Z"),
      durationMin: 45,
      settings: { ...base, cardSource: "generated", sameCard: false, adaptive: true },
      plan: DEMO_PLANS["demo-lesson-h3"],
      review: reviewedAll,
    }),
    await buildLesson({
      ...common,
      lessonNo: 3,
      id: "demo-lesson-h4",
      title: "Статусы по докладам бригады",
      status: "FINISHED",
      start: new Date("2026-09-21T07:00:00Z"),
      durationMin: 45,
      settings: { ...base, cardSource: "mixed", sameCard: false },
      plan: DEMO_PLANS["demo-lesson-h4"],
      review: reviewedAll,
    }),
  ];
  const l1 = await buildLesson({
    ...common,
    lessonNo: 4,
    id: "demo-lesson-1",
    title: "Пожары и газ: первые карточки",
    status: "FINISHED",
    start: new Date("2026-09-23T07:00:00Z"),
    durationMin: 45,
    settings: { ...base, cardSource: "generated", hints: true, sameCard: false },
    plan: DEMO_PLANS["demo-lesson-1"],
    review: () => "CONFIRMED",
  });
  const l2 = await buildLesson({
    ...common,
    lessonNo: 5,
    id: "demo-lesson-2",
    title: "Смешанный поток: 112 → ДДС",
    status: "FINISHED",
    start: new Date("2026-09-25T07:00:00Z"),
    durationMin: 40,
    settings: { ...base, cardSource: "mixed", sameCard: false },
    plan: DEMO_PLANS["demo-lesson-2"],
    review: (i, total) => (i < Math.floor(total * 0.4) ? "CONFIRMED" : "PENDING"),
  });
  await buildLesson({
    ...common,
    lessonNo: 6,
    id: "demo-lesson-3",
    title: "Итоговое: одна карточка на всех",
    status: "DRAFT",
    start: new Date(),
    durationMin: 45,
    settings: { ...base, cardSource: "generated", sameCard: true },
    plan: ["student1", "student2", "student3", "student4", "student5"].map((login) => ({ login, role: "DDS" as const, service: DEFAULT_DDS, tasks: ["Б30-3"] })),
    review: () => "PENDING",
  });
  if (live) await buildLive(ctx, group.id);

  // The forecast each lesson would have saved at its start: the same code, the attempts confirmed before it.
  let snapshots = 0;
  for (const id of DEMO_IDS) snapshots += await saveLessonForecasts(id, { client: db });

  const materials = await seedDemoMaterials(db);

  const counts = [...history, l1, l2].map((l) => l.attempts).join(", ");
  console.log(`seed-demo: 6 finished lessons (attempts ${counts}), draft lesson 3${live ? ", live lesson" : ""}; forecast snapshots ${snapshots}; materials ${materials}`);
}

export function disconnectDemo() {
  return db.$disconnect();
}

if (isEntry("seed-demo")) {
  seedDemo({ live: process.argv.includes("--live") })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
