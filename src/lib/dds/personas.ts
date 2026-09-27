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
};

/** What the leader says about a stage — these lines are the «доклады» the dispatcher turns into statuses. */
export function reportLine(stage: ServiceStatus | null, ctx: CrewContext): string {
  const who = `наряд ${ctx.crew}`;
  switch (stage) {
    case "STARTED":
      return `Диспетчер, ${who}, ${surname(ctx.leader)}. Выехали на ${ctx.address}, будем минут через десять.`;
    case "ARRIVED":
      // A card error shows on arrival: the crew tells the dispatcher what differs from the card.
      return ctx.plan.cardError
        ? `${cap(who)} прибыл на место, ${ctx.address}. Внимание, диспетчер: в карточке ошибка — ${clean(ctx.plan.cardError)}.`
        : `${cap(who)} прибыл на место, ${ctx.address}. Осматриваемся.`;
    case "WORKING":
      return `${cap(who)}: приступили к работам — ${clean(ctx.plan.work ?? "работаем на месте")}.`;
    case "FINISHED":
      return `${cap(who)}: работы закончили. ${cap(clean(ctx.plan.result ?? "всё устранили"))}. Возвращаемся на базу.`;
    case "REFUSED":
      return `${cap(who)}: на месте выяснили — ${clean(ctx.plan.refuse ?? "работы не по нашей части")}. Работы проводить не будем.`;
    default:
      return `${cap(who)}, ${surname(ctx.leader)}. Вызов приняли, собираемся, скоро выезжаем на ${ctx.address}.`;
  }
}

export function crewGreeting(ctx: CrewContext): string {
  return ctx.dispatched
    ? `${cap(`наряд ${ctx.crew}`)}, ${surname(ctx.leader)}, слушаю.`
    : `${cap(`наряд ${ctx.crew}`)}, ${surname(ctx.leader)}. Мы на базе, свободны. Куда выезжать?`;
}

const DISPATCH_WORDS = /(выезж|выезд|направ|отправ|поезжа|езжай|езжайте|срочно|адрес|работ[ау] по)/i;
const PROGRESS_WORDS = /(как|что там|обстанов|ход|доклад|доложи|статус|где вы|сделал|на месте|прибыл|выехал|закончил|работ)/i;
const ACK_WORDS = /(принят|понял|поняла|хорошо|спасибо|ясно|добро|отлично|записал|записала)/i;

/** The dispatcher sends a free crew to the card in words («выезжайте на…»). */
export function isDispatchOrder(text: string): boolean {
  return DISPATCH_WORDS.test(text);
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
  if (turn === 1 || PROGRESS_WORDS.test(said)) return { text: reportLine(ctx.stage, ctx), reported: ctx.stage ?? "DISPATCHED", dispatch: false };
  if (/адрес/i.test(said)) return { text: `Работаем по адресу ${ctx.address}.`, reported: null, dispatch: false };
  if (/(сколько|когда|долго|время)/i.test(said)) return { text: "Думаю, минут за двадцать управимся.", reported: null, dispatch: false };
  return { text: "Понял вас.", reported: null, dispatch: false };
}

export function crewPrompt(ctx: CrewContext): string {
  const facts = ctx.dispatched
    ? [
        `Твой наряд работает по происшествию: ${ctx.what}. Адрес: ${ctx.address}.`,
        `Где вы сейчас и что сделано: ${reportLine(ctx.stage, ctx)}`,
        ctx.plan.work ? `Работы на месте: ${ctx.plan.work}.` : "",
      ]
    : ["Сейчас твой наряд на базе и свободен. Если диспетчер называет адрес и задачу — подтверди, что выезжаете."];
  return [
    `Ты — ${ctx.leader}, старший наряда ${ctx.crew} (${ctx.title}). Говоришь по телефону с диспетчером своей дежурной службы.`,
    ...facts,
    "Отвечай одной-двумя короткими фразами, как на смене по рабочему телефону. Называй только эти факты; чего не знаешь — «уточню и перезвоню».",
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
  // Any run of five or more digits that is the number or its ending («…15003»).
  return (said.match(/\d{5,}/g) ?? []).some((run) => run.includes(num) || num.endsWith(run));
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

/** Offline 112 operator: wants the address, the card number and what changed, then takes the information. */
const CORRECTION = /(ошиб|неверн|неправильн|не тот|не та\b|не то\b|исправ|на самом деле|фактическ|перепута)/i;

export function operatorMockReply(said: string, turn: number): string {
  const hasPlace = /(адрес|улиц|дом|пос\.|посёл|посел|мкр|д\.\s*\d)/i.test(said);
  const hasCard = /(карточ|кп)\D{0,12}\d{5,}/i.test(said) || /\d{8}/.test(said);
  // An error in the card: the 112 operator corrects the card the dispatcher cannot edit.
  if (CORRECTION.test(said)) {
    return hasCard
      ? "Принял: исправлю карточку и сообщу всем службам по ней. Кто передал?"
      : "Понял, в карточке ошибка. Назовите номер карточки и что указать верно.";
  }
  if (hasPlace && hasCard) return "Информацию принял: дополню карточку и оповещу нужные службы. Что-то ещё?";
  if (turn >= 3 && (hasPlace || hasCard)) return "Принял, передам старшему смены. Спасибо.";
  if (!hasPlace) return "Назовите адрес происшествия и что изменилось на месте.";
  return "Назовите номер карточки, по которой вы работаете.";
}

export function operatorPrompt(ownService: string): string {
  return [
    `Ты — оператор ${OPERATOR_112}. Тебе звонит диспетчер ДДС «${ownService}»: обстановка на месте изменилась или в карточке ошибка.`,
    "Как по памятке: попроси представиться, назвать адрес, повод, номер карточки, по которой работает служба, и что изменилось.",
    "Если диспетчер сообщает об ошибке в карточке (адрес, подъезд, пострадавшие и т. п.) — попроси номер карточки и верные сведения: поля карточки 112 исправляешь ты, диспетчер ДДС их не правит.",
    "Когда всё названо — подтверди, что дополнишь или исправишь карточку и оповестишь службы. Одна-две короткие фразы, не говори, что ты программа.",
  ].join("\n");
}
