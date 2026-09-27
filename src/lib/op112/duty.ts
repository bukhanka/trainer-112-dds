/**
 * The duty dispatcher of a service that gets 112 cards only by phone («серая» плашка, Service.delivery = PHONE).
 * The memo on the services: «Телефонная связь – у службы нет возможности осуществить интеграцию или установить
 * АРМ-112, информация о происшествиях передается в службу только по телефону». After «сохранить» the 112 operator
 * calls such a service from the work-off row, passes the card and writes down who took it.
 *
 * The duty takes the card once the operator has named three things — the card number, the address and what
 * happened. That is decided by rules, so the review does not depend on a model; a model, when configured, only
 * phrases the lines. Without a model the lines are built by the same rules.
 */
import { chat, type ChatMessage } from "@/lib/ai/provider";
import { hash } from "@/lib/dds/bots";
import { sayable } from "@/lib/speech/sayable";
import { low } from "./facts";
import { parseStreet } from "./gazetteer";
import type { CallLine } from "./types";
import { dutyTitle } from "./workoffs";

export { dutyTitle };

/** What the duty needs to know about the card being passed. */
export type DutyContext = {
  service: string; // plate name, «Деп. ЖКХ»
  serviceFull?: string | null; // «Департамент ЖКХ»
  duty: string; // surname the duty gives when answering
  cardNumber: number;
  street?: string;
  house?: string;
  descriptive?: string;
  /** words of what happened: kind titles and «Класс.» names of the card */
  what: string[];
};

export type DutyReply = { text: string; accepted: boolean };

const SURNAMES_M = ["Петров", "Васильев", "Смирнов", "Кузнецов", "Орлов", "Лебедев", "Морозов", "Никитин"];
const SURNAMES_F = ["Петрова", "Васильева", "Смирнова", "Кузнецова", "Орлова", "Лебедева", "Морозова", "Никитина"];

/** The same service on the same card always has the same person on duty. */
export function dutyOf(serviceId: number, cardNumber: number): { duty: string; voice: "male" | "female" } {
  const h = hash(`${serviceId}:${cardNumber}`);
  const female = h % 2 === 1;
  const list = female ? SURNAMES_F : SURNAMES_M;
  return { duty: list[(h >>> 1) % list.length], voice: female ? "female" : "male" };
}

export function dutyGreeting(ctx: DutyContext): string {
  return sayable(`${ctx.serviceFull || ctx.service}, ${dutyTitle(ctx.duty)}, слушаю.`);
}

/** Digits said with spaces or dashes («36 815 072») count as one number. */
function joinDigits(text: string): string {
  return text.replace(/(\d)[\s-]+(?=\d)/g, "$1");
}

/** The card number, whole or its ending of five digits or more. */
export function namesCardNumber(text: string, cardNumber: number): boolean {
  const num = String(cardNumber);
  return (joinDigits(text).match(/\d{5,}/g) ?? []).some((run) => run.includes(num) || num.endsWith(run));
}

/** Words that name no place and no incident: every card has them. */
const GENERIC = new Set(["проис", "карто", "служб", "вызов", "други", "прочи"]);

/** Stems of the long words of a name: «улица Берзарина» → «берза». */
function stems(text: string): string[] {
  return low(text)
    .split(/[^а-яa-z0-9]+/)
    .filter((w) => w.length >= 5)
    .map((w) => w.slice(0, 5))
    .filter((s) => !GENERIC.has(s));
}

/** Everyday words for the kinds of the card («пожар» is also «горит», «дым»). */
const KIND_WORDS: Record<string, string[]> = {
  "101": ["пожар", "гори", "горит", "дым", "задым", "возгор", "пламя", "огонь"],
  "102": ["полиц", "драк", "краж", "угон", "хулиг", "напад"],
  "103": ["скор", "плохо", "травм", "постр", "больн"],
  "104": ["газ"],
  ДТП: ["дтп", "авари", "столк", "наезд"],
};

export function passedItems(ctx: DutyContext, said: string): { number: boolean; address: boolean; what: boolean } {
  const t = low(said);
  const street = ctx.street ? parseStreet(ctx.street).name : "";
  const place = stems(street || ctx.descriptive || "");
  const what = [...new Set([...ctx.what.flatMap((w) => KIND_WORDS[w] ?? []), ...ctx.what.flatMap(stems)])];
  return {
    number: namesCardNumber(said, ctx.cardNumber),
    // No street on the card: any word about the place will do.
    address: place.length ? place.some((s) => t.includes(s)) : /адрес|улиц|дом|район/.test(t),
    what: what.length ? what.some((w) => t.includes(w)) : true,
  };
}

const ASK: Record<"what" | "address" | "number", string> = {
  what: "Что случилось?",
  address: "Какой адрес?",
  number: "Номер карточки назовите.",
};
const THANKS = /спасибо|до связи|всего доброго|благодарю|до свидания/;

function missingOf(ctx: DutyContext, history: CallLine[], operatorText: string): ("what" | "address" | "number")[] {
  const said = [...history.filter((m) => m.role === "trainee").map((m) => m.text), operatorText].join(" ");
  const got = passedItems(ctx, said);
  return (["what", "address", "number"] as const).filter((k) => !got[k]);
}

/** The duty's line by rules; `accepted` marks the line that takes the card. */
export function dutyMockReply(ctx: DutyContext, history: CallLine[], operatorText: string): DutyReply {
  if (history.some((m) => m.accepted)) {
    return { text: THANKS.test(low(operatorText)) ? "До связи." : "Карточка принята, бригаде передано. Что-то ещё?", accepted: false };
  }
  const missing = missingOf(ctx, history, operatorText);
  if (!missing.length) {
    const where = [ctx.street, ctx.house && `дом ${ctx.house}`].filter(Boolean).join(", ") || ctx.descriptive || "";
    const title = dutyTitle(ctx.duty);
    return {
      text: `Принято, передаю бригаде. Записано: карточка ${ctx.cardNumber}${where ? `, ${where}` : ""}. ${title.charAt(0).toUpperCase()}${title.slice(1)}.`,
      accepted: true,
    };
  }
  return { text: missing.map((k) => ASK[k]).join(" "), accepted: false };
}

function dutyPrompt(ctx: DutyContext, missing: ("what" | "address" | "number")[], acceptedBefore: boolean): string {
  const now = acceptedBefore
    ? "Карточку ты уже принял. Если оператор прощается — коротко попрощайся, иначе спроси, что ещё."
    : missing.length
      ? `Для приёма карточки не хватает: ${missing.map((k) => ({ what: "что случилось", address: "адрес", number: "номер карточки" })[k]).join(", ")}. Спроси об этом одним коротким вопросом.`
      : `Оператор назвал всё нужное. Подтверди приём: «Принято, передаю бригаде», повтори номер карточки ${ctx.cardNumber} и назови свою фамилию — ${ctx.duty}.`;
  return [
    `Ты — ${dutyTitle(ctx.duty).split(" ")[0]} диспетчер: ${ctx.serviceFull || ctx.service}, фамилия ${ctx.duty}. Твоя служба получает карточки службы 112 только по телефону.`,
    "Звонит оператор 112 и передаёт карточку происшествия. Чтобы принять её, тебе нужны номер карточки, адрес и что случилось.",
    now,
    "Одна короткая фраза, как на дежурстве. Не выдумывай данных карточки, не говори, что ты программа.",
  ].join("\n");
}

const REPLY_TIMEOUT_MS = Math.min(Number(process.env.AI_TIMEOUT_MS ?? 45_000), 15_000);
const COOL_DOWN_MS = 2 * 60_000;
let modelDownUntil = 0;

/** The model's phrasing of the line, or null when the rules must speak (no model, a failure, a timeout). */
async function modelText(messages: ChatMessage[], mock: () => string): Promise<string | null> {
  if (Date.now() < modelDownUntil) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const text = await Promise.race([
      chat(messages, { tier: "fast", temperature: 0.4, maxTokens: 120, mock }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("duty: no reply in time")), REPLY_TIMEOUT_MS);
      }),
    ]);
    const clean = text.replace(/^\s*["«]|["»]\s*$/g, "").trim();
    return clean || null;
  } catch (err) {
    modelDownUntil = Date.now() + COOL_DOWN_MS;
    console.error("op112 duty: model unavailable, answering by rules", err instanceof Error ? err.message.slice(0, 200) : err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The duty's answer: acceptance by rules, words by the model when there is one. */
export async function dutyReply(ctx: DutyContext, history: CallLine[], operatorText: string): Promise<DutyReply> {
  const rules = dutyMockReply(ctx, history, operatorText);
  const messages: ChatMessage[] = [
    { role: "system", content: dutyPrompt(ctx, missingOf(ctx, history, operatorText), history.some((m) => m.accepted)) },
    ...history.map((m): ChatMessage => ({ role: m.role === "trainee" ? "user" : "assistant", content: m.text })),
    { role: "user", content: operatorText },
  ];
  const text = await modelText(messages, () => rules.text);
  return { text: sayable(text ?? rules.text), accepted: rules.accepted };
}
