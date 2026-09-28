/**
 * People on the other end of the ДДС phone: the crew leader, the applicant called back, the duty
 * dispatcher of another service or organisation. Each has a short prompt for a language model and a
 * deterministic line generator for the offline mode, built from the scenario facts only.
 */
import type { ServiceStatus } from "@prisma/client";
import type { CallerPersona } from "@/lib/incident/types";
import { hash } from "./bots";
import type { CrewPlan } from "./scenario";
import { STATUS_LABEL } from "./status";

// ─── Phone numbers ─────────────────────────────────────────────────────────

/**
 * The service list has no phone numbers, so a plate without one gets a training number: the short
 * 101–104 for the emergency services and «+7 (495) 000-XX-XX» built from the service id for the rest.
 */
export function servicePhone(s: { id: number; shortName: string; phone?: string | null }): string {
  if (s.phone) return s.phone;
  const short = /^Служба (10[1-4])$/.exec(s.shortName)?.[1];
  if (short) return short;
  return `+7 (495) 000-${String(Math.floor(s.id / 100) % 100).padStart(2, "0")}-${String(s.id % 100).padStart(2, "0")}`;
}

// ─── Crews of a service («книжка» of the place) ──────────────────────────────

export type CrewMember = { crew: string; title: string; leader: string; phone: string; voice: "male" | "female" };

const LEADERS = [
  "Громов Сергей Иванович",
  "Лаптев Игорь Павлович",
  "Сомова Наталья Андреевна",
  "Кравец Олег Петрович",
  "Зуев Антон Викторович",
  "Белкина Ирина Сергеевна",
  "Фомин Денис Олегович",
  "Осипов Максим Юрьевич",
  "Панова Елена Игоревна",
  "Рябов Виктор Николаевич",
];

function titlesFor(shortName: string): string[] {
  if (shortName === "Служба 101") return ["Отделение ПСЧ на автоцистерне", "Аварийно-спасательный отряд", "Оперативная группа"];
  if (shortName === "Служба 102") return ["Наряд ППС", "Участковый уполномоченный", "Следственно-оперативная группа"];
  if (shortName === "Служба 103") return ["Линейная бригада СМП", "Реанимационная бригада", "Бригада неотложной помощи"];
  if (shortName === "Служба 104") return ["Аварийная газовая бригада", "Бригада по ремонту газопровода", "Мастер участка"];
  return ["Аварийная бригада (сантехники)", "Электрики", "Дежурный техник"];
}

const CREW_NUMBERS = ["23", "17", "8"];

const voiceOf = (fullName: string): "male" | "female" => (/(вна|чна)$/.test(fullName) ? "female" : "male");

/** Three crews of the service, the same on every call. */
export function crewRoster(service: { id: number; shortName: string }): CrewMember[] {
  const titles = titlesFor(service.shortName);
  const start = hash(`crews:${service.id}`) % LEADERS.length;
  return CREW_NUMBERS.map((crew, i) => {
    const leader = LEADERS[(start + i * 3) % LEADERS.length];
    return {
      crew,
      title: titles[i],
      leader,
      phone: `+7 (916) 000-${crew.padStart(2, "0")}-${String(service.id % 100).padStart(2, "0")}`,
      voice: voiceOf(leader),
    };
  });
}

/** «Наряд № 23» → «23»: the dispatcher may type the word too. */
export function crewNumberOf(value: string): string {
  return value.trim().replace(/^наряд\s*№?\s*/i, "").trim();
}

/** A crew typed by hand in «Номер наряда» that is not in the book still answers. */
export function crewByNumber(service: { id: number; shortName: string }, crew: string): CrewMember {
  const number = crewNumberOf(crew);
  const known = crewRoster(service).find((c) => c.crew === number);
  if (known) return known;
  const leader = LEADERS[hash(`crew:${service.id}:${number}`) % LEADERS.length];
  return { crew: number, title: "Наряд", leader, phone: "", voice: voiceOf(leader) };
}

const surname = (fullName: string) => fullName.split(/\s+/)[0];
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const clean = (s: string) => s.trim().replace(/[.\s]+$/, "");

// ─── Crew reports ───────────────────────────────────────────────────────────

export type CrewContext = {
  crew: string;
  leader: string;
  title: string;
  address: string;
  what: string; // what happened, from the card
  plan: CrewPlan;
  dispatched: boolean;
  /** The last stage the crew has reached; null right after dispatch. */
  stage: ServiceStatus | null;
  /** The dispatcher has already heard a report of this crew from the site — the card error was told then. */
  errorTold?: boolean;
  /** The 112 operator has already corrected the card: it says what the crew sees on site. */
  errorFixed?: boolean;
  /** When the crew reached its stages, by the clock: «выехали в 08:12, прибыли в 08:13». */
  timeline?: string;
};

/** Stages the crew spends on site: from there it sees what differs from the card. */
const AT_SITE: readonly ServiceStatus[] = ["ARRIVED", "WORKING", "FINISHED", "REFUSED"];

export function atSite(stage: ServiceStatus | "DISPATCHED" | null | undefined): boolean {
  return !!stage && stage !== "DISPATCHED" && AT_SITE.includes(stage);
}

/** The crew on site knows about the error in the card while the 112 operator has not corrected it. */
function knowsCardError(ctx: CrewContext): boolean {
  return !!ctx.plan.cardError && atSite(ctx.stage) && !ctx.errorFixed;
}

/** The error in the card as the crew says it. */
export function cardErrorLine(ctx: CrewContext): string {
  return ctx.plan.cardError ? `Внимание, диспетчер: в карточке ошибка — ${clean(ctx.plan.cardError)}.` : "";
}

/**
 * The card error in a report from the site: always on arrival — as in the report the customer described — and in a
 * later report until the dispatcher has heard one from the site (the arrival call was missed).
 */
function errorNote(stage: ServiceStatus | null, ctx: CrewContext): string {
  if (!ctx.plan.cardError || !atSite(stage) || ctx.errorFixed) return "";
  return stage === "ARRIVED" || !ctx.errorTold ? ` ${cardErrorLine(ctx)}` : "";
}

/** What the crew has to tell about a stage, without the name of the crew. */
function stageNews(stage: ServiceStatus | null, ctx: CrewContext): string {
  switch (stage) {
    case "STARTED":
      // The training crew is fast: minutes would not match its pace (crew.ts), so no «минут через десять».
      return `выехали на ${ctx.address}, скоро будем.`;
    case "ARRIVED":
      return `прибыли на место, ${ctx.address}.${errorNote(stage, ctx) || " Осматриваемся."}`;
    case "WORKING":
      return `приступили к работам — ${clean(ctx.plan.work ?? "работаем на месте")}.${errorNote(stage, ctx)}`;
    case "FINISHED":
      return `работы закончили. ${cap(clean(ctx.plan.result ?? "всё устранили"))}.${errorNote(stage, ctx)} Возвращаемся на базу.`;
    case "REFUSED":
      return `на месте выяснили — ${clean(ctx.plan.refuse ?? "работы не по нашей части")}. Работы проводить не будем.${errorNote(stage, ctx)}`;
    default:
      return `вызов приняли, собираемся, скоро выезжаем на ${ctx.address}.`;
  }
}

/** What the leader says about a stage — these lines are the «доклады» the dispatcher turns into statuses. */
export function reportLine(stage: ServiceStatus | null, ctx: CrewContext): string {
  const who = `наряд ${ctx.crew}`;
  switch (stage) {
    case "STARTED":
      return `Диспетчер, ${who}, ${surname(ctx.leader)}. ${cap(stageNews(stage, ctx))}`;
    case "ARRIVED":
      // A card error shows on arrival: the crew tells the dispatcher what differs from the card.
      return `${cap(who)} прибыл на место, ${ctx.address}.${errorNote(stage, ctx) || " Осматриваемся."}`;
    case "WORKING":
    case "FINISHED":
    case "REFUSED":
      return `${cap(who)}: ${stageNews(stage, ctx)}`;
    default:
      return `${cap(who)}, ${surname(ctx.leader)}. ${cap(stageNews(null, ctx))}`;
  }
}

/**
 * The leader picks up the dispatcher's call. With `news` — a stage the dispatcher has not heard yet (the report
 * call was missed) — the leader reports it at once, the card error included, as in the report itself.
 */
export function crewGreeting(ctx: CrewContext, news = false): string {
  const hello = `${cap(`наряд ${ctx.crew}`)}, ${surname(ctx.leader)}`;
  if (!ctx.dispatched) return `${hello}. Мы на базе, свободны. Куда выезжать?`;
  return news && ctx.stage ? `${hello}, слушаю. Докладываю: ${stageNews(ctx.stage, ctx)}` : `${hello}, слушаю.`;
}

const DISPATCH_WORDS = /(выезж|выезд|направ|отправ|поезжа|езжай|езжайте|срочно|адрес|работ[ау] по)/i;
const PROGRESS_WORDS = /(как|что там|обстанов|ход|доклад|доложи|статус|где вы|сделал|на месте|прибыл|выехал|закончил|работ)/i;
const ACK_WORDS = /(принят|понял|поняла|хорошо|спасибо|ясно|добро|отлично|записал|записала)/i;
/** A question about what the card says: the address, the entrance, the building, victims, an error. */
const CARD_WORDS = /(адрес|подъезд|корпус|дом(?![а-яё]*ой)|пострадав|ошиб|совпа|верн(ый|ая|ое|ые|о)(?![а-яё])|правильн)/i;
/** «Во сколько прибыли?» — a stage already behind: the crew tells the time by the clock. */
const PAST_TIME = /(во сколько|в какое время|время (прибыт|выезд|начал|оконч|заверш)|когда (прибыл|выехал|начал|закончил))/i;
const TIME_WORDS = /(сколько|когда|долго|время|скоро)/i;

/** The dispatcher sends a free crew to the card in words («выезжайте на…»). */
export function isDispatchOrder(text: string): boolean {
  return DISPATCH_WORDS.test(text);
}

/** The crew's words mention the error in the card (the model's line is checked with it). */
export function mentionsCardError(text: string, ctx: CrewContext): boolean {
  if (/(ошиб|неверн|не тот|не т[ао](?![а-яё])|на самом деле)/i.test(text)) return true;
  const t = text.toLowerCase().replace(/ё/g, "е");
  return (ctx.plan.cardErrorSay ?? []).some((src) => new RegExp(src, "i").test(t));
}

/** «Когда будете?» in words that fit the crew's fast training pace — no minutes. */
function timeAnswer(ctx: CrewContext): string {
  if (ctx.stage === "FINISHED" || ctx.stage === "REFUSED") return "Уже закончили, возвращаемся на базу.";
  return atSite(ctx.stage) ? "Скоро закончим — доложу сразу." : "Скоро будем — доложу, как прибудем.";
}

export type CrewReply = { text: string; reported: ServiceStatus | "DISPATCHED" | null; dispatch: boolean };

/** Offline crew leader. `turn` is the number of the dispatcher's line in this call, from 1. */
export function crewMockReply(ctx: CrewContext, said: string, turn: number): CrewReply {
  if (!ctx.dispatched) {
    if (isDispatchOrder(said)) {
      return { text: `Принял, наряд ${ctx.crew} выезжает на ${ctx.address}.`, reported: "DISPATCHED", dispatch: true };
    }
    return { text: "Мы на базе, ждём указаний. Скажите адрес и что случилось — выедем.", reported: null, dispatch: false };
  }
  // «Принято» after a report is an acknowledgement, not a question.
  if (ACK_WORDS.test(said) && !said.includes("?")) return { text: "Понял. Будут изменения — доложу.", reported: null, dispatch: false };
  if (PAST_TIME.test(said) && ctx.timeline) return { text: `По часам: ${ctx.timeline}.`, reported: null, dispatch: false };
  // «Адрес в карточке совпал?» — on site the crew answers as it is there, not as the card says.
  if (CARD_WORDS.test(said) && knowsCardError(ctx)) return { text: `Нет. ${cardErrorLine(ctx)}`, reported: ctx.stage, dispatch: false };
  if (turn === 1 || PROGRESS_WORDS.test(said)) return { text: reportLine(ctx.stage, ctx), reported: ctx.stage ?? "DISPATCHED", dispatch: false };
  if (/адрес/i.test(said)) return { text: `Работаем по адресу ${ctx.address}.`, reported: null, dispatch: false };
  if (TIME_WORDS.test(said)) return { text: timeAnswer(ctx), reported: null, dispatch: false };
  return { text: "Понял вас.", reported: null, dispatch: false };
}

/** The crew still has to tell the dispatcher about the error in the card: on site, not told, not corrected yet. */
export function owesCardError(ctx: CrewContext): boolean {
  return knowsCardError(ctx) && !ctx.errorTold;
}

export function crewPrompt(ctx: CrewContext): string {
  const error = ctx.plan.cardError && atSite(ctx.stage) ? clean(ctx.plan.cardError) : "";
  const facts = ctx.dispatched
    ? [
        `Твой наряд работает по происшествию: ${ctx.what}. Адрес по карточке: ${ctx.address}.`,
        `Где вы сейчас и что сделано: ${reportLine(ctx.stage, ctx)}`,
        ctx.plan.work ? `Работы на месте: ${ctx.plan.work}.` : "",
        ctx.timeline ? `Время этапов по часам: ${ctx.timeline}. Если спрашивают, во сколько — называй это время.` : "",
        error && !ctx.errorFixed
          ? `Важно: в карточке ошибка — ${error}. На вопросы про адрес, подъезд, корпус, пострадавших отвечай так, как на месте, а не как в карточке.`
          : "",
        error && ctx.errorFixed ? `В карточке была ошибка — ${error}; оператор 112 её уже исправил, карточка теперь верная.` : "",
        owesCardError(ctx) ? "Диспетчер об ошибке в карточке ещё не знает: обязательно скажи о ней в этом ответе." : "",
      ]
    : ["Сейчас твой наряд на базе и свободен. Если диспетчер называет адрес и задачу — подтверди, что выезжаете."];
  return [
    `Ты — ${ctx.leader}, старший наряда ${ctx.crew} (${ctx.title}). Говоришь по телефону с диспетчером своей дежурной службы.`,
    ...facts,
    "Отвечай одной-двумя короткими фразами, как на смене по рабочему телефону. Называй только эти факты; чего не знаешь — «уточню и перезвоню».",
    "Сроки не называй в минутах и часах: учебный наряд работает быстро — говори «скоро будем», «скоро закончим».",
    "Не выдумывай пострадавших, адреса и номера. Не говори, что ты программа. Без списков и пояснений — только твоя реплика.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── The applicant called back (#739–740) ─────────────────────────────────────

export type CallerContext = { persona: CallerPersona; cardNumber: number };

/** The dispatcher named the card number — the memo says not to (the applicant does not know it). */
export function mentionsCardNumber(said: string, cardNumber: number): boolean {
  const num = String(cardNumber);
  // Speech recognition may split the number into groups («36 815 072»): digits apart by a space or a dash are one run.
  const joined = said.replace(/(\d)[\s.-](?=\d)/g, "$1");
  // Any run of five or more digits that is the number or its ending («…15003»).
  return (joined.match(/\d{5,}/g) ?? []).some((run) => run.includes(num) || num.endsWith(run));
}

export function callerGreeting(persona: CallerPersona): string {
  return persona.temper === "panic" ? "Алло! Да, слушаю!" : "Алло, слушаю.";
}

const stems = (text: string) =>
  new Set(
    (text.toLowerCase().match(/[а-яё]{4,}/g) ?? [])
      .filter((w) => !/^(есть|было|были|этот|этом|тоже|очень|сейчас|скажите|пожалуйста|здравствуйте|уточните)$/.test(w))
      .map((w) => w.slice(0, 4)),
  );

/** The fact that shares most word stems with the question, if any. */
function bestFact(facts: string[], question: string): string | null {
  const asked = stems(question);
  let best: string | null = null;
  let score = 0;
  for (const f of facts) {
    const overlap = [...stems(f)].filter((w) => asked.has(w)).length;
    if (overlap > score) {
      best = f;
      score = overlap;
    }
  }
  return best;
}

/** Offline applicant: answers from the facts of the ticket, one fact at a time. */
export function callerMockReply(ctx: CallerContext, said: string, turn: number): string {
  const p = ctx.persona;
  const facts = p.facts.length ? p.facts : [p.situation];
  const called = p.voice === "female" ? "звонила" : p.voice === "male" ? "звонил" : "звонил(а)";
  const sentence = (f: string) => `${cap(clean(f))}.`;
  if (mentionsCardNumber(said, ctx.cardNumber)) return `Какой номер? Я никаких номеров не знаю, я просто ${called} в 112.`;
  if (/(адрес|где|куда|улиц|дом\b|подъезд|этаж|квартир|точн)/i.test(said)) {
    const precise = /(подъезд|этаж|квартир|точн|уточн)/i.test(said) && p.hiddenAddress;
    return precise ? `${cap(p.visibleAddress)}, ${p.hiddenAddress}.` : `${cap(p.visibleAddress)}.`;
  }
  const fact = (re: RegExp, fallback: string) => {
    const found = facts.find((f) => re.test(f));
    return found ? sentence(found) : fallback;
  };
  if (/(пострада|ранен|плохо|скор|медиц|врач)/i.test(said)) return fact(/(пострада|скор|плохо|самочув|помощь)/i, "Пострадавших нет, все целы.");
  if (/газ/i.test(said)) return fact(/газ/i, "Про газ ничего сказать не могу.");
  if (turn === 1 || /(звонил|звонила|по поводу|что случил|что у вас|произошл|расскаж)/i.test(said)) {
    return `Да, ${called}. ${sentence(p.situation)}`;
  }
  if (/(спасибо|до свидания)/i.test(said)) return "Спасибо вам, ждём!";
  const matched = bestFact(facts, said);
  if (matched) return sentence(matched);
  return turn - 1 <= facts.length ? sentence(facts[(turn - 2 + facts.length) % facts.length]) : "Больше ничего не знаю. Приезжайте скорее, пожалуйста!";
}

const TEMPER: Record<NonNullable<CallerPersona["temper"]>, string> = {
  calm: "Говоришь спокойно.",
  panic: "Ты взволнован(а), говоришь торопливо, но по делу.",
  elderly: "Ты пожилой человек, говоришь медленно и переспрашиваешь.",
  child: "Ты ребёнок, говоришь просто и коротко.",
  drunk: "Ты выпил(а), путаешься, но главное помнишь.",
  angry: "Ты раздражён(а), что помощь ещё не пришла.",
};

export function callerPrompt(ctx: CallerContext): string {
  const p = ctx.persona;
  return [
    `Ты — ${p.fullName} (${p.role}). Недавно ты звонил(а) по номеру 112: ${p.situation}.`,
    "Сейчас тебе перезванивает диспетчер дежурной службы. Отвечай по телефону от первого лица, одной-двумя фразами.",
    `Адрес ты называешь так: ${p.visibleAddress}.${p.hiddenAddress ? ` Если попросят уточнить: ${p.hiddenAddress}.` : ""}`,
    `Что ты знаешь: ${p.facts.join("; ") || p.situation}. Больше ничего не придумывай.`,
    "Номеров карточек ты не знаешь: если диспетчер назовёт номер, удивись и переспроси.",
    TEMPER[p.temper ?? "calm"],
    "Не говори, что ты программа. Без списков — только твоя реплика.",
  ].join("\n");
}

// ─── Another service or an organisation from the card ───────────────────────

export type ServiceContext = {
  name: string; // «Служба 101», «Диспетчерская ООО «Практика» (лифты)»
  ownService: string;
  address: string;
  what: string;
  status?: ServiceStatus; // their plate on the card, if they are on it
  crew?: string | null;
};

export function serviceGreeting(ctx: ServiceContext): string {
  return `${ctx.name}, дежурный диспетчер, слушаю.`;
}

export function serviceMockReply(ctx: ServiceContext, said: string, turn: number): string {
  if (ACK_WORDS.test(said) && turn > 1) return "Хорошо, до связи.";
  if (ctx.status) {
    const crew = ctx.crew ? `, работает наряд ${ctx.crew}` : "";
    return `Информацию принял. По этому адресу у нас статус «${STATUS_LABEL[ctx.status]}»${crew}.`;
  }
  return turn === 1 ? `Информацию принял, записываю: ${ctx.address}. Передам дежурному мастеру.` : "Принято, работаем.";
}

export function servicePrompt(ctx: ServiceContext): string {
  return [
    `Ты — дежурный диспетчер: ${ctx.name}. Тебе звонит диспетчер ДДС «${ctx.ownService}» по происшествию: ${ctx.what}, адрес ${ctx.address}.`,
    ctx.status
      ? `Ваша служба уже работает по этой карточке, статус «${STATUS_LABEL[ctx.status]}»${ctx.crew ? `, наряд ${ctx.crew}` : ""}.`
      : "Эта информация для вас новая: прими её и пообещай передать мастеру.",
    "Отвечай одной короткой фразой, как на дежурстве. Не говори, что ты программа.",
  ].join("\n");
}

// ─── Служба 112: the memo's call when the situation on site changed ──────────

export const OPERATOR_112 = "Служба 112";

export function operatorGreeting(): string {
  return "Служба 112, оператор слушает. Представьтесь, пожалуйста.";
}

/** Words of a reported error in the card. */
const CORRECTION = /(ошиб|неверн|неправильн|не тот|не т[ао](?![а-яё])|исправ|на самом деле|фактическ|перепута)/i;

/**
 * Where the dispatcher's call to 112 stands. The operator's words follow what the system has really done
 * (card-fix.ts): the card is corrected only when its number and the right information are named.
 *   fixed      — corrected on this line;       already  — corrected before;
 *   needInfo   — the card with an error named, the right information not yet;
 *   needNumber — an error reported, no card number;  none — anything else (the situation changed).
 */
export type OperatorState =
  | { kind: "fixed" | "already"; card: number; label: string }
  | { kind: "needInfo"; card: number }
  | { kind: "needNumber" }
  | { kind: "none"; card: number | null };

/** The trainee's words so far report an error in the card. */
export function reportsCardError(said: string): boolean {
  return CORRECTION.test(said);
}

/** Offline 112 operator: wants the card number and what is right, corrects the card; else takes the information. */
export function operatorMockReply(said: string, turn: number, state: OperatorState = { kind: "none", card: null }): string {
  switch (state.kind) {
    case "fixed":
      return `Принято. В карточке ${state.card} исправил: ${state.label}. В журнале карточки есть отметка, службы по карточке видят изменение.`;
    case "already":
      return `По карточке ${state.card} исправление уже внесено: ${state.label}.`;
    case "needInfo":
      return `Карточку ${state.card} вижу. Что в ней указать верно?`;
    case "needNumber":
      return "Понял, в карточке ошибка. Назовите номер карточки и что указать верно.";
  }
  const hasPlace = /(адрес|улиц|дом|пос\.|посёл|посел|мкр|д\.\s*\d)/i.test(said);
  const hasCard = state.card !== null || /(карточ|кп)\D{0,12}\d{5,}/i.test(said) || /\d{8}/.test(said);
  if (reportsCardError(said)) return hasCard ? "Что именно указать в карточке верно?" : "Понял, в карточке ошибка. Назовите номер карточки и что указать верно.";
  // Nothing in the card changes on such a call: the operator takes the information, it does not claim a correction.
  if (hasPlace && hasCard) return "Информацию принял, передам старшему смены 112. Что-то ещё?";
  if (turn >= 3 && (hasPlace || hasCard)) return "Принял, передам старшему смены. Спасибо.";
  if (!hasPlace) return "Назовите адрес происшествия и что изменилось на месте.";
  return "Назовите номер карточки, по которой вы работаете.";
}

/** «Исправил», «обновил», «оповестил», «внесено» — a claim that something was done in the card. */
const DONE_WORDS =
  /(исправил|исправлен|обновил|обновлен|обновлён|внесл|внёс|внес(?![а-яё])|внесен|внесён|изменил|изменен|изменён|дополнил|дополнен|оповестил|оповещен|оповещён|скорректировал|поправил)/i;

/** The model's line claims a change in the card that was not made: the operator must not say it. */
export function claimsCardChange(text: string): boolean {
  return DONE_WORDS.test(text);
}

export function operatorPrompt(ownService: string, state: OperatorState = { kind: "none", card: null }): string {
  const now =
    state.kind === "fixed"
      ? `Ты только что исправил карточку ${state.card}: ${state.label}; в журнале карточки запись «Изменено оператором 112». Подтверди коротко, что исправил, — службы по карточке видят изменение.`
      : state.kind === "already"
        ? `Карточку ${state.card} ты уже исправил раньше: ${state.label}. Скажи, что исправление уже внесено.`
        : state.kind === "needInfo"
          ? `Диспетчер назвал карточку ${state.card}, но ещё не сказал, что указать верно: спроси. Карточку ты пока не менял — не говори, что исправил, обновил или оповестил.`
          : state.kind === "needNumber"
            ? "Номер карточки ещё не назван: попроси его. Карточку ты пока не менял — не говори, что исправил, обновил или оповестил."
            : "В карточке ты сейчас ничего не меняешь: прими информацию и скажи, что передашь старшему смены. Не говори, что исправил, обновил, дополнил карточку или оповестил службы.";
  return [
    `Ты — оператор ${OPERATOR_112}. Тебе звонит диспетчер ДДС «${ownService}»: обстановка на месте изменилась или в карточке ошибка.`,
    "Как по памятке: попроси представиться, назвать адрес, повод, номер карточки, по которой работает служба, и что изменилось.",
    "Если диспетчер сообщает об ошибке в карточке (адрес, подъезд, пострадавшие и т. п.) — нужны номер карточки и верные сведения: поля карточки 112 исправляешь ты, диспетчер ДДС их не правит.",
    `Сейчас: ${now}`,
    "Одна-две короткие фразы, не говори, что ты программа.",
  ].join("\n");
}
