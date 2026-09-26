/**
 * Demo lessons for the teacher cabinet, built on the real ticket scenarios and services
 * (run `pnpm db:seed` first — it loads them): two finished lessons of «Учебная группа № 1» with
 * attempts of both kinds (112 and ДДС), part confirmed by the teacher and part waiting for review,
 * plus a draft lesson ready to start.
 *
 *   pnpm exec tsx prisma/seed-demo.ts          finished lessons + draft
 *   pnpm exec tsx prisma/seed-demo.ts --live   also a running lesson with timers relative to now
 *
 * Idempotent: the demo lessons are deleted and rebuilt. Reference data is only read, never written.
 * The work at the places is simulated here with student profiles (strong / weak); on a real lesson
 * the same rows come from the 112 and ДДС workstations.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient, type Prisma, type ServiceDelivery, type ServiceStatus } from "@prisma/client";
import { computeScore, type CriterionResult, type Weights } from "../src/lib/scoring/score";
import { ruleDraft } from "../src/lib/review/draft";

const db = new PrismaClient();

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
const rnd = prng(20260929);
const between = (lo: number, hi: number) => Math.round(lo + rnd() * (hi - lo));
const chance = (p: number) => rnd() < p;
const at = (base: Date, sec: number) => new Date(base.getTime() + sec * 1000);
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec) % 60).padStart(2, "0")}`;

const VORONOVSKOE = 191;
const HOROSHEVO = 87;
const MESHCHANSKY = 111;
const DEFAULT_CHAIN: ServiceStatus[] = ["STARTED", "ARRIVED", "WORKING", "FINISHED"];
const PROGRESS = new Set<ServiceStatus>(["STARTED", "ARRIVED", "WORKING", "FINISHED"]);

// ─── scenarios from the reference data ───────────────────────────────────────
type Ref = { decision: "accept" | "reject"; chain: ServiceStatus[]; report: string | null; comment: string | null };

type Fx = {
  id: string;
  ticketRef: string;
  title: string;
  caller: { fullName: string; role?: string; phone?: string; visibleAddress: string; hiddenAddress?: string; situation: string; facts: string[]; voice?: string };
  services: number[];
  address: string;
  street: string | null;
  description: string;
  question: string | null;
  flags: Prisma.InputJsonValue;
  ref: (serviceId: number | null) => Ref;
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

function toFx(s: { id: string; ticketRef: string | null; title: string; caller: unknown; truth: unknown; ddsCard: unknown; ddsReference: unknown }, known: Set<number>): Fx {
  const truth = isObj(s.truth) ? s.truth : {};
  const card = isObj(s.ddsCard) ? s.ddsCard : {};
  const caller = (isObj(s.caller) ? s.caller : {}) as Fx["caller"];
  const address = isObj(truth.address) ? truth.address : {};
  const services = (Array.isArray(truth.services) ? truth.services : [])
    .map((x) => (isObj(x) ? Number(x.serviceId) : NaN))
    .filter((id) => Number.isInteger(id) && known.has(id));
  const refs = isObj(s.ddsReference) && Array.isArray(s.ddsReference.services) ? (s.ddsReference.services as Obj[]) : [];
  const questions = (Array.isArray(truth.requiredQuestions) ? truth.requiredQuestions : []).map(str).filter((q): q is string => !!q);
  return {
    id: s.id,
    ticketRef: s.ticketRef ?? "",
    title: s.title.replace(/^Б\d+-\d+\.\s*/, ""),
    caller: { ...caller, facts: Array.isArray(caller.facts) ? caller.facts : [] },
    services,
    address: str(card.address) ?? str(truth.addressLine) ?? caller.visibleAddress ?? "адрес не указан",
    street: str(address.street),
    description: str(card.description) ?? s.title,
    question: questions.find((q) => !/адрес|ФИО|телефон/i.test(q)) ?? null,
    flags: (isObj(truth.flags) ? truth.flags : {}) as Prisma.InputJsonValue,
    ref: (serviceId) => {
      const e = refs.find((r) => Number(r.serviceId) === serviceId);
      // The ДДС card flow uses the same default: without a reference entry the plate is to be accepted.
      if (!e) return { decision: "accept", chain: DEFAULT_CHAIN, report: null, comment: null };
      const chain = (Array.isArray(e.chain) ? e.chain : []).filter((x): x is ServiceStatus => typeof x === "string" && PROGRESS.has(x as ServiceStatus));
      return {
        decision: e.decision === "REJECTED" ? "reject" : "accept",
        chain: chain.length ? chain : DEFAULT_CHAIN,
        report: str(e.brigadeReport) === "—" ? null : str(e.brigadeReport),
        comment: str(e.decisionComment),
      };
    },
  };
}

// A look-alike street for the critical address error: a real pair when we know one, else a one-letter slip.
const confusable = (() => {
  try {
    const raw = JSON.parse(readFileSync(path.join(__dirname, "..", "data", "confusable-streets.json"), "utf8")) as { pairs?: { a: string; b: string }[] };
    return raw.pairs ?? [];
  } catch {
    return [];
  }
})();
function lookAlike(street: string): string {
  const pair = confusable.find((p) => p.a === street || p.b === street);
  if (pair) return pair.a === street ? pair.b : pair.a;
  const swap: Record<string, string> = { е: "и", и: "е", о: "а", а: "о", у: "ю" };
  const chars = [...street];
  const i = chars.findIndex((c, k) => k > 3 && swap[c]);
  if (i < 0) return `${street}ая`;
  chars[i] = swap[chars[i]];
  return chars.join("");
}

// ─── student profiles: who is strong and where the weak ones fail ───────────
type Profile = {
  ack: [number, number];
  dispatch: [number, number];
  typing: [number, number];
  skipProgress: number;
  noHandover: number;
  lookAlikeStreet: number;
  sloppyText: number;
  wrongDecision: number;
  missQuestion: number;
  wrongServices: number;
};
const PROFILES: Record<string, Profile> = {
  student1: { ack: [12, 24], dispatch: [80, 150], typing: [44, 60], skipProgress: 0, noHandover: 0, lookAlikeStreet: 0, sloppyText: 0, wrongDecision: 0, missQuestion: 0.1, wrongServices: 0 },
  student2: { ack: [18, 32], dispatch: [100, 170], typing: [52, 70], skipProgress: 0.2, noHandover: 0.2, lookAlikeStreet: 0, sloppyText: 0.2, wrongDecision: 0, missQuestion: 0.2, wrongServices: 0.2 },
  student3: { ack: [26, 58], dispatch: [140, 260], typing: [66, 98], skipProgress: 0.4, noHandover: 0.4, lookAlikeStreet: 0.7, sloppyText: 0.5, wrongDecision: 0.3, missQuestion: 0.5, wrongServices: 0.4 },
  student4: { ack: [16, 30], dispatch: [110, 190], typing: [55, 75], skipProgress: 0.2, noHandover: 0.8, lookAlikeStreet: 0.1, sloppyText: 0.3, wrongDecision: 0.25, missQuestion: 0.3, wrongServices: 0.1 },
  student5: { ack: [34, 75], dispatch: [150, 240], typing: [60, 90], skipProgress: 0.6, noHandover: 0.5, lookAlikeStreet: 0.3, sloppyText: 0.4, wrongDecision: 0.2, missQuestion: 0.4, wrongServices: 0.3 },
};

const HANDOVER_BAD = "Не наша территория";

type Ctx = { weights: Weights; teacherId: string; ackSec: number; workSec: number; typingSec: number };
type Event = { status: ServiceStatus; sec: number; comment?: string; crew?: string };
type Review = "CONFIRMED" | "OVERRIDDEN" | "PENDING";

// ─── ДДС: one own plate handled at a place ───────────────────────────────────
function simulateDds(fx: Fx, serviceId: number | null, serviceName: string, p: Profile, ctx: Ctx, cut: number | null) {
  const ref = fx.ref(serviceId);
  const events: Event[] = [{ status: "RECEIVED", sec: between(3, 8) }];
  const crits: CriterionResult[] = [];
  const ack = between(p.ack[0], p.ack[1]);
  const wrongDecision = chance(p.wrongDecision);
  const decision = wrongDecision ? (ref.decision === "accept" ? "reject" : "accept") : ref.decision;
  const crew = String(between(11, 48));
  const sloppy = chance(p.sloppyText);
  const skip = chance(p.skipProgress);
  const goodHandover = !chance(p.noHandover);
  const handover = ref.comment ?? "Не принята: адрес вне зоны обслуживания. Передано в ДДС района по месту происшествия, дежурному Орлову";

  if (decision === "reject") {
    events.push({ status: "REJECTED", sec: ack, comment: goodHandover ? handover : wrongDecision ? "Не наш профиль" : HANDOVER_BAD });
  } else {
    events.push({ status: "ACCEPTED", sec: ack, crew, comment: sloppy ? "отпр бр" : `Направлена бригада, наряд ${crew}` });
    let t = between(p.dispatch[0], p.dispatch[1]);
    for (const status of ref.chain) {
      if (skip && (status === "ARRIVED" || status === "WORKING")) continue;
      if (status !== "STARTED") t += between(200, 330);
      const comment =
        status === "STARTED"
          ? sloppy
            ? "выехали"
            : "Бригада выехала на место"
          : status === "FINISHED"
            ? sloppy
              ? "Сделано"
              : (ref.report ?? "Работы завершены, опасности для жителей нет")
            : status === "ARRIVED"
              ? "Бригада прибыла на место"
              : "Проводятся работы";
      events.push({ status, sec: t, crew, comment });
    }
  }
  // A lesson may end before the crew finishes: those plates stay «Не завершено».
  const kept = cut == null ? events : events.filter((e) => e.sec <= cut);

  const answer = kept.find((e) => e.status === "ACCEPTED" || e.status === "REJECTED");
  crits.push({
    code: "dds.ack_in_time",
    group: "timeliness",
    title: "Ответ «Принята» / «Не принята» за 30 с",
    ok: answer ? answer.sec <= ctx.ackSec : false,
    evidence: answer ? `«${answer.status === "ACCEPTED" ? "Принята" : "Не принята"}» через ${mmss(answer.sec)} после «Добавлена»` : "Ответа нет",
    expected: `не позже ${mmss(ctx.ackSec)}`,
    source: "rule",
  });
  const started = kept.find((e) => e.status === "STARTED");
  crits.push({
    code: "dds.crew_in_time",
    group: "timeliness",
    title: "Наряд отправлен за 3 мин",
    ok: decision === "reject" ? null : started ? started.sec <= ctx.workSec : false,
    evidence: started ? `«Начало реагирования» через ${mmss(started.sec)}` : decision === "reject" ? undefined : "Статуса «Начало реагирования» нет",
    expected: `не позже ${mmss(ctx.workSec)}`,
    source: "rule",
  });
  if (decision === "accept") {
    const finished = kept.find((e) => e.status === "FINISHED");
    crits.push({
      code: "dds.progress_statuses",
      group: "statusOrder",
      title: "Статусы хода работ по докладам наряда",
      ok: !skip,
      evidence: skip ? "Наряд доложил о прибытии и начале работ, статусы «Прибытие» и «Проведение работ» не выставлены" : undefined,
      expected: "Принята → Начало реагирования → Прибытие → Проведение работ → Работы завершены",
      source: "rule",
    });
    crits.push({
      code: "dds.closing_status",
      group: "statusOrder",
      title: "Карточка закрыта итоговым статусом",
      ok: Boolean(finished),
      evidence: finished ? undefined : "К концу занятия нет «Работы завершены»",
      expected: "закрыть карточку «Работы завершены» с итогом",
      source: "rule",
    });
    crits.push({
      code: "dds.final_comment",
      group: "comments",
      title: "Итог работ в комментарии",
      ok: finished ? !sloppy : null,
      evidence: finished ? `Комментарий: «${finished.comment}»` : undefined,
      expected: "что сделано и в каком состоянии объект",
      source: "rule",
    });
  }
  const rejected = kept.find((e) => e.status === "REJECTED");
  crits.push({
    code: "dds.transfer_named",
    group: "comments",
    title: "К «Не принята» указано, кому передано",
    ok: rejected ? rejected.comment !== HANDOVER_BAD && rejected.comment !== "Не наш профиль" : null,
    evidence: rejected ? `Комментарий: «${rejected.comment}»` : undefined,
    expected: "причина и кому передано (служба, фамилия дежурного)",
    source: "rule",
  });
  crits.push({
    code: "dds.decision",
    group: "services",
    title: ref.decision === "accept" ? "Профильное происшествие принято" : "Не принята по эталону",
    ok: !wrongDecision,
    critical: ref.decision === "accept",
    evidence: wrongDecision ? (ref.decision === "accept" ? `«Не принята» — эталон для «${serviceName}»: принять и направить наряд` : "«Принята», хотя по эталону служба не реагирует") : undefined,
    expected: ref.decision === "accept" ? "Принята, направить наряд" : (ref.comment ?? "Не принята с комментарием, кому передано"),
    source: "rule",
  });
  crits.push({
    code: "dds.literacy",
    group: "literacy",
    title: "Комментарии понятны следующему диспетчеру",
    ok: !sloppy,
    evidence: sloppy ? "«отпр бр», «выехали» — непонятно, кто и куда" : undefined,
    expected: "Полные фразы: кто направлен, номер наряда, что делают",
    source: "ai",
  });
  return { events: kept, crits };
}

// ─── 112: a card filled at a place ───────────────────────────────────────────
function simulate112(fx: Fx, p: Profile, ctx: Ctx) {
  const typing = between(p.typing[0], p.typing[1]);
  const wrongStreet = fx.street && chance(p.lookAlikeStreet) ? lookAlike(fx.street) : null;
  const missQuestion = Boolean(fx.question) && chance(p.missQuestion);
  const wrongServices = chance(p.wrongServices);
  const sloppy = chance(p.sloppyText);
  const crits: CriterionResult[] = [
    {
      code: "op112.typing_time",
      group: "timeliness",
      title: "Карточка сохранена до красного таймера",
      ok: typing <= ctx.typingSec,
      evidence: `Карточка сохранена через ${mmss(typing)}`,
      expected: `не позже ${mmss(ctx.typingSec)}`,
      source: "rule",
    },
    {
      code: "op112.address_street",
      group: "address",
      title: "Улица записана верно",
      ok: fx.street ? !wrongStreet : null,
      critical: true,
      evidence: wrongStreet ? `Заявитель: «${fx.street}»; в карточке: «${wrongStreet}»` : undefined,
      expected: wrongStreet ? `${fx.street} — похожая улица отправит наряд по другому адресу` : undefined,
      source: "rule",
    },
    {
      code: "op112.address_clarified",
      group: "address",
      title: "Адрес уточнён до дома и ориентира",
      ok: fx.caller.hiddenAddress ? !(wrongStreet && chance(0.5)) : null,
      evidence: `Заявитель сначала сказал: «${fx.caller.visibleAddress}»`,
      expected: fx.caller.hiddenAddress,
      source: "rule",
    },
    {
      code: "op112.services",
      group: "services",
      title: "Службы выбраны верно",
      ok: !wrongServices,
      evidence: wrongServices ? "Не добавлена ДДС префектуры округа" : undefined,
      expected: "ДДС района + ДДС префектуры округа + профильные службы",
      source: "rule",
    },
    {
      code: "op112.questions",
      group: "completeness",
      title: "Обязательные вопросы опросной карты",
      ok: fx.question ? !missQuestion : null,
      evidence: missQuestion ? `Не задан вопрос: ${fx.question}` : undefined,
      expected: fx.question ?? undefined,
      source: "rule",
    },
    {
      code: "op112.said_vs_filled",
      group: "completeness",
      title: "Сказанное заявителем совпадает с карточкой",
      ok: !(missQuestion && chance(0.6)),
      evidence: `Заявитель: «${fx.caller.situation}»`,
      expected: "Все факты из разговора перенесены в описание и признаки",
      source: "ai",
    },
    {
      code: "op112.description_clear",
      group: "literacy",
      title: "Описание понятно службе",
      ok: !sloppy,
      evidence: sloppy ? `«${fx.description.toLowerCase().replace(/[.,]/g, "").split(" ").slice(0, 5).join(" ")} срочн»` : undefined,
      expected: "Коротко и полно: что случилось, где, есть ли угроза людям",
      source: "ai",
    },
  ];
  return { typing, crits, wrongStreet };
}

function dialogue(fx: Fx, start: Date) {
  const c = fx.caller;
  const lines: [string, string][] = [
    ["trainee", "Служба 112, что у вас случилось?"],
    ["counterpart", c.situation],
    ["trainee", "Назовите адрес."],
    ["counterpart", c.visibleAddress],
    ["trainee", "Уточните, пожалуйста: улица, дом, ориентир."],
    ["counterpart", c.hiddenAddress ?? c.visibleAddress],
    ["trainee", "Как вас зовут?"],
    ["counterpart", c.fullName],
    ["counterpart", c.facts[0] ?? ""],
    ["trainee", "Информация принята, службы оповещены."],
  ];
  return lines.filter(([, t]) => t).map(([role, text], i) => ({ role, text, at: at(start, 4 + i * 6).toISOString() }));
}

// ─── lesson builder ──────────────────────────────────────────────────────────
type SeatPlan = { login: string; role: "OP112" | "DDS"; serviceId?: number; tasks: string[] };
type ServiceInfo = { shortName: string; delivery: ServiceDelivery };
type SeatRow = { id: string; studentId: string; role: "OP112" | "DDS"; serviceId: number | null; plan: SeatPlan; login: string; fullName: string };

async function buildLesson(opts: {
  id: string;
  title: string;
  status: "FINISHED" | "DRAFT";
  start: Date;
  durationMin: number;
  plan: SeatPlan[];
  settings: Record<string, unknown>;
  review: (i: number, total: number) => Review;
  ctx: Ctx;
  groupId: string;
  fx: Map<string, Fx>;
  services: Map<number, ServiceInfo>;
}) {
  const { ctx } = opts;
  const students = await db.user.findMany({ where: { login: { in: opts.plan.map((p) => p.login) } } });
  const byLogin = new Map(students.map((s) => [s.login, s]));
  const finishedAt = opts.status === "FINISHED" ? at(opts.start, opts.durationMin * 60) : null;

  await db.lesson.create({
    data: {
      id: opts.id,
      title: opts.title,
      teacherId: ctx.teacherId,
      groupId: opts.groupId,
      status: opts.status,
      settings: opts.settings as Prisma.InputJsonValue,
      startedAt: opts.status === "DRAFT" ? null : opts.start,
      finishedAt,
      createdAt: at(opts.start, -3600),
    },
  });

  const taskIds = (p: SeatPlan) => p.tasks.map((ref) => opts.fx.get(ref)?.id).filter((x): x is string => !!x);
  const seats: SeatRow[] = [];
  for (const [i, p] of opts.plan.entries()) {
    const student = byLogin.get(p.login);
    if (!student) continue;
    const serviceId = p.role === "DDS" ? (p.serviceId ?? VORONOVSKOE) : null;
    const seat = await db.seat.create({
      data: { lessonId: opts.id, studentId: student.id, role: p.role, serviceId, scenarioIds: taskIds(p), label: `Место ${i + 1}`, createdAt: at(opts.start, -3600 + i) },
    });
    seats.push({ id: seat.id, studentId: student.id, role: p.role, serviceId, plan: p, login: student.login, fullName: student.fullName });
  }
  if (opts.status === "DRAFT") return { attempts: 0 };

  const lessonEndSec = opts.durationMin * 60;
  const attempts: Prisma.AttemptCreateManyInput[] = [];
  // Cards typed at 112 places reach the ДДС places of their services only when the lesson takes students' cards.
  const routeToDds = opts.settings.cardSource !== "generated";

  for (const seat of seats) {
    const profile = PROFILES[seat.login] ?? PROFILES.student2;
    for (const [k, ticket] of seat.plan.tasks.entries()) {
      const fx = opts.fx.get(ticket);
      if (!fx) continue;
      const offset = 120 + k * between(540, 660) + between(0, 40);
      const t0 = at(opts.start, offset);

      if (seat.role === "OP112") {
        const sim = simulate112(fx, profile, ctx);
        const operatorNo = String(900 + seats.indexOf(seat));
        const incident = await db.incident.create({
          data: {
            lessonId: opts.id,
            scenarioId: fx.id,
            source: "op112",
            createdBySeatId: seat.id,
            operatorNo,
            armNo: String(seats.indexOf(seat) + 1),
            status: "worked",
            caller: { fullName: fx.caller.fullName, status: "очевидец", aon: fx.caller.phone ?? null },
            address: { descriptive: sim.wrongStreet && fx.street ? fx.address.replace(fx.street, sim.wrongStreet) : fx.address },
            flags: fx.flags,
            description: fx.description,
            descriptionLog: [{ at: at(t0, sim.typing).toISOString(), author: `оп. ${operatorNo}`, text: fx.description }],
            openedAt: t0,
            savedAt: at(t0, sim.typing),
            workedAt: at(t0, sim.typing + 40),
            createdAt: t0,
          },
        });
        await db.call.create({
          data: {
            lessonId: opts.id,
            seatId: seat.id,
            incidentId: incident.id,
            kind: "CALLER_IN",
            status: "ENDED",
            counterpart: { name: fx.caller.fullName, role: "заявитель", voice: fx.caller.voice ?? "female" },
            messages: dialogue(fx, t0),
            startedAt: at(t0, -5),
            answeredAt: t0,
            endedAt: at(t0, 70),
          },
        });
        const addedAt = at(t0, sim.typing + 1);
        for (const serviceId of fx.services) {
          const target = routeToDds ? seats.find((s) => s.role === "DDS" && s.serviceId === serviceId) : undefined;
          const plate = await db.incidentService.create({
            data: { incidentId: incident.id, serviceId, isMain: serviceId === fx.services[0], addedBy: "auto", status: "ADDED", addedAt },
          });
          const events: Prisma.StatusEventCreateManyInput[] = [{ incidentServiceId: plate.id, status: "ADDED", actorLabel: "оп. 0", at: addedAt }];
          if (target) {
            const tProfile = PROFILES[target.login] ?? PROFILES.student2;
            const cut = finishedAt ? lessonEndSec - (offset + sim.typing + 1) : null;
            const dds = simulateDds(fx, serviceId, opts.services.get(serviceId)?.shortName ?? "", tProfile, ctx, cut);
            events.push(...ownEvents(plate.id, dds.events, addedAt, target, ctx));
            await closePlate(plate.id, dds.events);
            attempts.push(attemptRow(opts.id, target, "DDS", incident.id, plate.id, fx.id, dds.crits, at(addedAt, (dds.events.at(-1)?.sec ?? 0) + 5), ctx));
          } else {
            const bot = botEvents(serviceId, addedAt, plate.id, opts.services);
            events.push(...bot.events);
            if (bot.last) await db.incidentService.update({ where: { id: plate.id }, data: { status: bot.last } });
          }
          await db.statusEvent.createMany({ data: events });
        }
        attempts.push(attemptRow(opts.id, seat, "OP112", incident.id, null, fx.id, sim.crits, at(t0, sim.typing + 5), ctx));
      } else {
        // A generated card sent to this ДДС place; its own plate is always on the card, as in the card flow.
        const cut = finishedAt ? lessonEndSec - offset : null;
        const incident = await db.incident.create({
          data: {
            lessonId: opts.id,
            scenarioId: fx.id,
            source: "generated",
            operatorNo: "0",
            armNo: String(1 + (k % 9)),
            status: "registered",
            caller: { fullName: fx.caller.fullName, status: "очевидец" },
            address: { descriptive: fx.address },
            flags: fx.flags,
            description: fx.description,
            descriptionLog: [{ at: t0.toISOString(), author: "0 УМЦ О.п.", text: fx.description }],
            savedAt: t0,
            createdAt: t0,
          },
        });
        const own = seat.serviceId!;
        const dds = simulateDds(fx, own, opts.services.get(own)?.shortName ?? "", profile, ctx, cut);
        for (const serviceId of [...new Set([...fx.services, own])]) {
          const plate = await db.incidentService.create({
            data: { incidentId: incident.id, serviceId, isMain: serviceId === fx.services[0], addedBy: "auto", addedAt: t0 },
          });
          // The ADDED event records the place the card was delivered to.
          const events: Prisma.StatusEventCreateManyInput[] = [
            { incidentServiceId: plate.id, status: "ADDED", actorLabel: "оп. 0", seatId: serviceId === own ? seat.id : null, at: t0 },
          ];
          if (serviceId === own) {
            events.push(...ownEvents(plate.id, dds.events, t0, seat, ctx));
            await closePlate(plate.id, dds.events);
            attempts.push(attemptRow(opts.id, seat, "DDS", incident.id, plate.id, fx.id, dds.crits, at(t0, (dds.events.at(-1)?.sec ?? 0) + 5), ctx));
          } else {
            const bot = botEvents(serviceId, t0, plate.id, opts.services);
            events.push(...bot.events);
            if (bot.last) await db.incidentService.update({ where: { id: plate.id }, data: { status: bot.last } });
          }
          await db.statusEvent.createMany({ data: events });
        }
      }
    }
  }

  // Review state: the teacher confirmed the earlier attempts; some AI checks were corrected.
  attempts.sort((a, b) => new Date(a.createdAt as Date).getTime() - new Date(b.createdAt as Date).getTime());
  for (const [i, a] of attempts.entries()) {
    const review = opts.review(i, attempts.length);
    const criteria = a.criteria as unknown as CriterionResult[];
    if (review === "PENDING") continue;
    a.reviewStatus = review;
    a.reviewedById = ctx.teacherId;
    a.reviewedAt = at(finishedAt ?? opts.start, 600 + i * 45);
    if (review === "OVERRIDDEN") {
      const target = criteria.find((c) => c.source === "ai" && c.ok === false) ?? criteria.find((c) => c.source === "ai");
      if (target) {
        a.override = { [target.code]: !target.ok };
        a.teacherComment = target.ok
          ? "ИИ не заметил: в тексте нет главного — есть ли угроза людям. Засчитываю как ошибку."
          : "Сокращения понятны любому диспетчеру, смысл передан. Засчитываю.";
      }
    } else if (criteria.some((c) => c.ok === false)) {
      a.teacherComment = "Разобрали на занятии. Обратите внимание на ошибки ниже.";
    }
    a.score = computeScore(criteria, ctx.weights, a.override as Record<string, boolean | null> | undefined);
  }
  await db.attempt.createMany({ data: attempts });
  return { attempts: attempts.length };
}

function ownEvents(plateId: string, events: Event[], addedAt: Date, seat: { id: string; studentId: string; fullName: string }, ctx: Ctx): Prisma.StatusEventCreateManyInput[] {
  return events.map((e) => ({
    incidentServiceId: plateId,
    status: e.status,
    comment: e.comment,
    crewNumber: e.crew,
    actorLabel: seat.fullName,
    actorUserId: seat.studentId,
    seatId: seat.id,
    late: e.status === "ACCEPTED" || e.status === "REJECTED" ? e.sec > ctx.ackSec : false,
    at: at(addedAt, e.sec),
  }));
}

async function closePlate(plateId: string, events: Event[]) {
  const last = events.at(-1);
  await db.incidentService.update({ where: { id: plateId }, data: { status: last?.status ?? "ADDED", crewNumber: events.find((e) => e.crew)?.crew } });
}

function attemptRow(
  lessonId: string,
  seat: { id: string; studentId: string },
  kind: "OP112" | "DDS",
  incidentId: string,
  incidentServiceId: string | null,
  scenarioId: string,
  criteria: CriterionResult[],
  createdAt: Date,
  ctx: Ctx,
): Prisma.AttemptCreateManyInput {
  return {
    lessonId,
    seatId: seat.id,
    studentId: seat.studentId,
    kind,
    incidentId,
    incidentServiceId,
    scenarioId,
    criteria: criteria as unknown as Prisma.InputJsonValue,
    aiDraft: ruleDraft(criteria) as unknown as Prisma.InputJsonValue,
    score: computeScore(criteria, ctx.weights),
    reviewStatus: "PENDING",
    createdAt,
  };
}

/** Services nobody plays in the lesson answer in time, as the card flow's bots do. */
function botEvents(serviceId: number, addedAt: Date, plateId: string, services: Map<number, ServiceInfo>) {
  const svc = services.get(serviceId);
  if (!svc || svc.delivery === "PHONE") return { events: [] as Prisma.StatusEventCreateManyInput[], last: null };
  const actor = svc.delivery === "VIS" ? "оп. 9999" : "оп. 0";
  const chain: [ServiceStatus, number, string][] = [
    ["RECEIVED", between(2, 6), ""],
    ["ACCEPTED", between(10, 25), "Принято в работу"],
    ["STARTED", between(90, 160), "Выезд"],
  ];
  return {
    events: chain.map(([status, sec, comment]) => ({ incidentServiceId: plateId, status, comment: comment || undefined, actorLabel: actor, at: at(addedAt, sec) })),
    last: "STARTED" as ServiceStatus,
  };
}

// ─── running lesson with timers relative to now ─────────────────────────────
async function buildLive(ctx: Ctx, groupId: string, fx: Map<string, Fx>) {
  const start = new Date(Date.now() - 7 * 60_000);
  const students = await db.user.findMany({ where: { login: { in: ["student1", "student2", "student3", "student4", "student5"] } }, orderBy: { login: "asc" } });
  await db.lesson.create({
    data: {
      id: "demo-lesson-live",
      title: "Живое занятие (демо)",
      teacherId: ctx.teacherId,
      groupId,
      status: "RUNNING",
      startedAt: start,
      settings: { categories: [], cardSource: "mixed", tempoSec: 90, maxQueue: 3, ackSec: ctx.ackSec, workSec: ctx.workSec, typingSec: ctx.typingSec, hints: false, brigadeReports: true, sameCard: false },
    },
  });
  const tasks = ["Б30-3", "Б2-1", "Б5-1", "Б1-1", "Б17-1"];
  const roles: ("OP112" | "DDS")[] = ["OP112", "DDS", "DDS", "DDS", "OP112"];
  const seats = [];
  for (const [i, s] of students.entries()) {
    seats.push(
      await db.seat.create({
        data: {
          lessonId: "demo-lesson-live",
          studentId: s.id,
          role: roles[i],
          serviceId: roles[i] === "DDS" ? VORONOVSKOE : null,
          scenarioIds: [fx.get(tasks[i])?.id].filter((x): x is string => !!x),
          label: `Место ${i + 1}`,
        },
      }),
    );
  }
  const now = Date.now();
  const ago = (sec: number) => new Date(now - sec * 1000);
  // Place 1 (112): a call in progress, the card is being typed for 48 s.
  const gas = fx.get("Б30-3")!;
  const draft = await db.incident.create({
    data: { lessonId: "demo-lesson-live", scenarioId: gas.id, source: "op112", createdBySeatId: seats[0].id, status: "draft", openedAt: ago(48), createdAt: ago(48) },
  });
  await db.call.create({
    data: {
      lessonId: "demo-lesson-live",
      seatId: seats[0].id,
      incidentId: draft.id,
      kind: "CALLER_IN",
      status: "ACTIVE",
      counterpart: { name: gas.caller.fullName, role: "заявитель", voice: gas.caller.voice ?? "female" },
      messages: dialogue(gas, ago(48)).slice(0, 5),
      startedAt: ago(52),
      answeredAt: ago(48),
    },
  });
  // Places 2–4 (ДДС): one on time with a second card in the queue, one late with the answer, one refusal without an addressee.
  const live: { seat: (typeof seats)[number]; ticket: string; addedAgo: number; events: Event[] }[] = [
    { seat: seats[1], ticket: "Б2-1", addedAgo: 95, events: [{ status: "RECEIVED", sec: 4 }, { status: "ACCEPTED", sec: 17, comment: "Направлена бригада, наряд 23", crew: "23" }] },
    { seat: seats[2], ticket: "Б5-1", addedAgo: 44, events: [{ status: "RECEIVED", sec: 6 }] },
    { seat: seats[3], ticket: "Б1-1", addedAgo: 130, events: [{ status: "RECEIVED", sec: 5 }, { status: "REJECTED", sec: 26, comment: HANDOVER_BAD }] },
    { seat: seats[1], ticket: "Б31-3", addedAgo: 12, events: [] },
  ];
  for (const item of live) {
    const f = fx.get(item.ticket);
    if (!f) continue;
    const t0 = ago(item.addedAgo);
    const incident = await db.incident.create({
      data: { lessonId: "demo-lesson-live", scenarioId: f.id, source: "generated", status: "registered", address: { descriptive: f.address }, description: f.description, savedAt: t0, createdAt: t0 },
    });
    const plate = await db.incidentService.create({ data: { incidentId: incident.id, serviceId: VORONOVSKOE, addedBy: "auto", addedAt: t0 } });
    const student = students.find((s) => s.id === item.seat.studentId)!;
    await db.statusEvent.createMany({
      data: [
        { incidentServiceId: plate.id, status: "ADDED", actorLabel: "оп. 0", seatId: item.seat.id, at: t0 },
        ...ownEvents(plate.id, item.events, t0, { id: item.seat.id, studentId: student.id, fullName: student.fullName }, ctx),
      ],
    });
    await db.incidentService.update({ where: { id: plate.id }, data: { status: item.events.at(-1)?.status ?? "ADDED" } });
  }
  await db.attempt.create({
    data: {
      lessonId: "demo-lesson-live",
      seatId: seats[4].id,
      studentId: seats[4].studentId,
      kind: "OP112",
      scenarioId: fx.get("Б17-1")?.id,
      criteria: simulate112(fx.get("Б17-1")!, PROFILES.student5, ctx).crits as unknown as Prisma.InputJsonValue,
      reviewStatus: "PENDING",
      createdAt: ago(200),
    },
  });
}

// ─── main ────────────────────────────────────────────────────────────────────
const TICKETS = ["Б30-3", "Б2-1", "Б31-3", "Б5-1", "Б1-1", "Б26-1", "Б32-2", "Б4-1", "Б11-1", "Б29-1", "Б17-1"];

/** Rebuilds the demo lessons (fixed ids) from the approved ticket scenarios. */
export async function seedDemo({ live = false }: { live?: boolean } = {}) {
  const teacher = await db.user.findUnique({ where: { login: "teacher" } });
  const group = await db.group.findFirst({ where: { name: "Учебная группа № 1" } });
  const serviceRows = await db.service.findMany({ select: { id: true, shortName: true, delivery: true } });
  const scenarioRows = await db.scenario.findMany({ where: { ticketRef: { in: TICKETS } } });
  if (!teacher || !group || !serviceRows.some((s) => s.id === VORONOVSKOE) || scenarioRows.length < TICKETS.length) {
    throw new Error("Сначала загрузите учётки и справочники: pnpm db:seed");
  }
  // Lessons deal only approved scenarios, as the teacher would have approved them in «Сценарии».
  const drafts = scenarioRows.filter((s) => s.status !== "APPROVED").map((s) => s.ticketRef);
  if (drafts.length) throw new Error(`Сценарии ${drafts.join(", ")} не утверждены — утвердите их в «Сценариях» или обновите справочники`);

  const services = new Map(serviceRows.map((s) => [s.id, { shortName: s.shortName, delivery: s.delivery }]));
  const known = new Set(services.keys());
  const fx = new Map(scenarioRows.map((s) => [s.ticketRef!, toFx(s, known)]));

  const profile = await db.weightProfile.findFirst({ where: { isActive: true } });
  const weights = (profile?.weights ?? { timeliness: 3, statusOrder: 2, comments: 2, address: 3, services: 3, completeness: 1, literacy: 1 }) as Weights;
  const ctx: Ctx = { weights, teacherId: teacher.id, ackSec: 30, workSec: 180, typingSec: 65 };

  await db.lesson.deleteMany({ where: { id: { in: ["demo-lesson-1", "demo-lesson-2", "demo-lesson-3", "demo-lesson-live"] } } });

  const base = { categories: [], tempoSec: 90, maxQueue: 3, ackSec: 30, workSec: 180, typingSec: 65, hints: false, brigadeReports: true };
  const common = { groupId: group.id, ctx, fx, services };
  const l1 = await buildLesson({
    ...common,
    id: "demo-lesson-1",
    title: "Пожары и газ: первые карточки",
    status: "FINISHED",
    start: new Date("2026-09-23T07:00:00Z"),
    durationMin: 45,
    settings: { ...base, cardSource: "generated", hints: true, sameCard: false },
    plan: [
      { login: "student1", role: "OP112", tasks: ["Б30-3", "Б2-1"] },
      { login: "student2", role: "DDS", tasks: ["Б31-3", "Б5-1", "Б30-3"] },
      { login: "student3", role: "DDS", tasks: ["Б1-1", "Б26-1", "Б32-2"] },
      { login: "student4", role: "DDS", tasks: ["Б4-1", "Б11-1", "Б29-1"] },
      { login: "student5", role: "OP112", tasks: ["Б17-1", "Б29-1"] },
    ],
    review: (i) => (i % 7 === 3 ? "OVERRIDDEN" : "CONFIRMED"),
  });
  const l2 = await buildLesson({
    ...common,
    id: "demo-lesson-2",
    title: "Смешанный поток: 112 → ДДС",
    status: "FINISHED",
    start: new Date("2026-09-25T07:00:00Z"),
    durationMin: 40,
    settings: { ...base, cardSource: "mixed", sameCard: false },
    plan: [
      { login: "student1", role: "DDS", serviceId: VORONOVSKOE, tasks: ["Б31-3", "Б5-1"] },
      { login: "student2", role: "OP112", tasks: ["Б30-3", "Б2-1"] },
      { login: "student3", role: "OP112", tasks: ["Б17-1", "Б29-1"] },
      { login: "student4", role: "DDS", serviceId: HOROSHEVO, tasks: ["Б26-1"] },
      { login: "student5", role: "DDS", serviceId: MESHCHANSKY, tasks: ["Б11-1", "Б32-2"] },
    ],
    review: (i, total) => (i < Math.floor(total * 0.4) ? (i === 2 ? "OVERRIDDEN" : "CONFIRMED") : "PENDING"),
  });
  await buildLesson({
    ...common,
    id: "demo-lesson-3",
    title: "Итоговое: одна карточка на всех",
    status: "DRAFT",
    start: new Date(),
    durationMin: 45,
    settings: { ...base, cardSource: "generated", sameCard: true },
    plan: ["student1", "student2", "student3", "student4", "student5"].map((login) => ({ login, role: "DDS" as const, tasks: ["Б30-3"] })),
    review: () => "PENDING",
  });
  if (live) await buildLive(ctx, group.id, fx);

  console.log(`seed-demo: lesson 1 — ${l1.attempts} attempts, lesson 2 — ${l2.attempts} attempts, draft lesson 3${live ? ", live lesson" : ""}`);
}

export function disconnectDemo() {
  return db.$disconnect();
}

if (require.main === module) {
  seedDemo({ live: process.argv.includes("--live") })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    })
    .finally(() => db.$disconnect());
}
