/**
 * AI caller for the 112 place: a person from a training ticket who phones the operator.
 *
 * With a language model configured the caller is played by the model (prompt below, written for
 * this trainer). Without a model the caller answers by rules: the operator's question is matched
 * to a topic and the matching fact from the ticket is said — so the demo works offline and every
 * run is repeatable. In both modes each caller line records which facts it disclosed; the review
 * later checks that every disclosed fact made it into the card.
 */
import { z } from "zod";
import type { CallerPersona } from "@/lib/incident/types";
import { chat, chatJson, type ChatMessage } from "@/lib/ai/provider";
import { countUsage } from "@/lib/admin/usage";
import { sayable } from "@/lib/speech/sayable";
import { askedTopics, bestFactByWords, evidenced, expandRevealed, factCards, low, speech } from "./facts";
import type { CallLine, FactCard, FactTopic } from "./types";

export type Persona = CallerPersona & { factCards?: FactCard[] };
export type CallerReply = { text: string; revealed: string[] };
/** Who is on the operator's chair, as far as the caller can tell: an elderly caller says «сынок» only to a man. */
export type Gender = "male" | "female" | null;

/** Gender by the full name: the patronymic, else the surname ending; null when the name does not tell. */
export function genderOfName(fullName: string | null | undefined): Gender {
  const words = (fullName ?? "").trim().toLowerCase().split(/\s+/);
  const patronymic = words[2] ?? "";
  if (/(вич|ич|оглы)$/.test(patronymic)) return "male";
  if (/(вна|чна|кызы)$/.test(patronymic)) return "female";
  const surname = words[0] ?? "";
  if (/(ова|ева|ёва|ина|ая)$/.test(surname)) return "female";
  if (/(ов|ев|ёв|ин|ий|ой)$/.test(surname)) return "male";
  return null;
}

const TEMPER: Record<NonNullable<CallerPersona["temper"]>, string> = {
  calm: "Говоришь спокойно и по делу, но сам разговор не ведёшь — ждёшь вопросов.",
  panic:
    "Ты напуган и торопишься: короткие фразы, повторяешь «быстрее», можешь сбиться. На прямой вопрос всё же отвечаешь, пусть и не с первого раза.",
  elderly: "Ты пожилой человек: говоришь медленно, иногда переспрашиваешь, путаешься в новых названиях.",
  child:
    "Тебе около десяти лет: говоришь просто, боишься, взрослых подробностей (номер дома, этажность, газ) можешь не знать — тогда так и скажи.",
  drunk: "Ты выпил: отвечаешь не сразу и не всегда по вопросу, но то, что знаешь, говоришь верно.",
  angry: "Ты раздражён, что тебя долго расспрашивают, но на вопросы отвечаешь.",
};

/** How the caller addresses the operator: an elderly «сынок» / «дочка» only when it is clear who answered. */
function addressLine(p: Persona, gender: Gender): string {
  if (p.temper !== "elderly") return "";
  if (gender === "male") return "К оператору можешь обратиться «сынок».";
  if (gender === "female") return "К оператору можешь обратиться «дочка».";
  return "Кто на линии, ты не знаешь: обращайся на «вы», без «сынок» и «дочка».";
}

function systemPrompt(p: Persona, cards: FactCard[], gender: Gender = null): string {
  const seen = new Set<string>();
  const facts = cards
    .filter((c) => !["situation", "address", "addressExact", "name", "status", "phone"].includes(c.key))
    .filter((c) => {
      const id = c.group ?? c.key;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .map((c) => `- [${c.group ?? c.key}] ${sayable(c.text)}`)
    .join("\n");
  return [
    "Это учебный тренажёр службы 112. Ты играешь заявителя — человека, который сам позвонил на 112. На линии обучающийся оператор, он заполняет карточку происшествия по твоим словам.",
    "",
    `Кто ты: ${p.fullName}, ${p.role}. Голос ${p.voice === "male" ? "мужской" : "женский"}.`,
    TEMPER[p.temper ?? "calm"],
    addressLine(p, gender),
    "",
    `[situation] Что случилось, твоими словами: ${speech(p.situation)}`,
    `[address] Место ты называешь так: «${sayable(p.visibleAddress)}».`,
    p.hiddenAddress
      ? `[addressExact] Точное место ты знаешь: «${sayable(p.hiddenAddress)}». Сам его не называй. Скажи его только тогда, когда оператор просит уточнить адрес: номер дома, корпус, ориентир, «где именно», «что рядом».`
      : "",
    `[name] Твоё имя — называй, если спросят, как тебя зовут.`,
    `[status] Кем ты приходишься происшествию: ${p.role}.`,
    p.phone ? `[phone] Твой телефон ${p.phone} — называй, если спросят номер для связи.` : "",
    "",
    facts ? `Что ещё ты знаешь. Говори это только в ответ на вопрос о том же, по одному факту за раз:\n${facts}` : "",
    "",
    "Как отвечать:",
    "1. Ты уже снял трубку и сказал только «Алло…». На приветствие или первый вопрос оператора сначала скажи, что у тебя случилось, — одной-двумя фразами, своими словами.",
    "2. Дальше отвечай только на то, что спросили. Сам всё сразу не выкладывай.",
    "3. Не повторяй слово в слово то, что уже говорил. Переспросили — ответь коротко («Я же говорю — горит!») или добавь новую подробность. Адрес, имя и телефон по просьбе повтори.",
    "4. Говори как живой человек по телефону: короткие фразы, обрывки, эмоции, можно сбиться. Без книжных оборотов и канцелярита: не «произошло возгорание», а «горит»; не «в настоящее время», а «сейчас». Без ремарок в скобках, звёздочек и описания действий.",
    "5. Адрес говори полными словами, как вслух: «улица», «дом», «квартира», без сокращений. Номера домов, квартир, телефонов и другие числа пиши цифрами, как в твоих сведениях.",
    "6. Чего в твоих сведениях нет — не выдумывай: «не знаю», «отсюда не видно».",
    "7. Не выходи из роли, не называй себя программой, не подсказывай оператору, что ему делать.",
    "8. Если оператор говорит не по делу, верни разговор к своей беде. Если сказал, что помощь едет, — коротко поблагодари.",
    "",
    'Верни JSON: {"reply": "твоя реплика", "revealed": ["ключи сведений из квадратных скобок, которые ты назвал в этой реплике"]}.',
  ]
    .filter((line) => line !== "")
    .join("\n");
}

const replySchema = z.object({ reply: z.string().min(1), revealed: z.array(z.string()).optional() });

/** The rule-based answer in the same JSON shape the model returns. */
const asJson = (r: CallerReply) => JSON.stringify({ reply: r.text, revealed: r.revealed });

function toMessages(history: CallLine[]): ChatMessage[] {
  return history.map((m) => ({ role: m.role === "trainee" ? "user" : "assistant", content: m.text }));
}

// ─── Model access that never leaves the trainee without an answer ────────────

/** A caller must answer within seconds; a stuck model is replaced by the rule-based caller. */
const REPLY_TIMEOUT_MS = Math.min(Number(process.env.AI_TIMEOUT_MS ?? 45_000), 20_000);
/** After a model failure (key expired, server down) the rules answer for a while without waiting on it again. */
const COOL_DOWN_MS = 2 * 60_000;
let modelDownUntil = 0;

class ReplyTimeout extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new ReplyTimeout(`no reply in ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** The model's line, or null when the rules must answer (no model, a failure, a timeout). */
async function modelLine(messages: ChatMessage[], cards: FactCard[], mock: () => string): Promise<CallerReply | null> {
  if (Date.now() < modelDownUntil) {
    countUsage("ai.rules");
    return null;
  }
  try {
    return cleanCallerReply(await withTimeout(chatJson(messages, replySchema, { temperature: 0.6, maxTokens: 250, tier: "fast", mock }), REPLY_TIMEOUT_MS), cards);
  } catch (err) {
    // A model that answers but cannot keep to JSON still gets a plain reply; its disclosures are guessed.
    if (err instanceof Error && /invalid JSON/i.test(err.message)) {
      try {
        const text = await withTimeout(chat(messages, { temperature: 0.6, maxTokens: 200 }), REPLY_TIMEOUT_MS);
        if (text.trim()) return { text: sayable(text), revealed: guessRevealed(text, cards) };
      } catch {
        /* fall through to the rules */
      }
    }
    modelDownUntil = Date.now() + COOL_DOWN_MS;
    console.error("op112 caller: model unavailable, answering by rules", err instanceof Error ? err.message.slice(0, 200) : err);
    return null;
  }
}

// ─── Silent and breaking lines («нет контакта» / «срыв звонка») ─────────────

/** What the operator hears on a silent line, and the beeps once the other side is gone. Never spoken aloud. */
export const NOISE_TEXT = {
  silence: "…тишина, в трубке только шум…",
  hangup: "…короткие гудки: связь прервалась…",
} as const;

export type LineTurn = { kind: "talk" } | { kind: "silence"; hangup: boolean } | { kind: "drop"; words?: string };

/**
 * How the line meets the operator's next line — by rules only, so a task behaves the same with and without a
 * model. A silent line stays silent, and after `dropAfter` tries (3 by default) the other side hangs up. A breaking
 * line breaks on the `dropAfter`-th operator line (2 by default) or when the operator asks for the address a second
 * time — counted by the operator's own questions, since a model does not always report what it said.
 */
export function lineTurn(p: Persona, history: CallLine[], operatorText: string): LineTurn {
  const asked = history.filter((m) => m.role === "trainee");
  const turn = asked.length + 1;
  if (p.line === "silent") return { kind: "silence", hangup: turn >= (p.dropAfter ?? 3) };
  if (p.line !== "drops") return { kind: "talk" };
  const aboutAddress = (text: string) => askedTopics(text).some((t) => t === "address" || t === "addressExact");
  const named = asked.some((m) => aboutAddress(m.text)) || history.some((m) => m.revealed?.includes("address"));
  return turn >= (p.dropAfter ?? 2) || (named && aboutAddress(operatorText)) ? { kind: "drop", words: p.dropLine } : { kind: "talk" };
}

/** The lines the operator gets for a turn that is not a reply: silence, or the last words and the beeps. */
export function noiseLines(turn: Exclude<LineTurn, { kind: "talk" }>, at: string): CallLine[] {
  if (turn.kind === "silence") {
    const silence: CallLine = { role: "counterpart", text: NOISE_TEXT.silence, at, revealed: [], noise: "silence" };
    return turn.hangup ? [silence, { role: "counterpart", text: NOISE_TEXT.hangup, at, revealed: [], noise: "hangup" }] : [silence];
  }
  return [
    ...(turn.words ? [{ role: "counterpart" as const, text: sayable(turn.words), at, revealed: [] }] : []),
    { role: "counterpart", text: NOISE_TEXT.hangup, at, revealed: [], noise: "hangup" },
  ];
}

/**
 * First words when the operator picks up: a short «Алло…» by temper (`greetingLine`), with or without a model —
 * the story comes after the operator's greeting, so it is never told twice.
 */
export async function callerOpening(p: Persona): Promise<CallerReply & { noise?: "silence" }> {
  if (p.line === "silent") return { text: NOISE_TEXT.silence, revealed: [], noise: "silence" };
  // A written opening (a call that breaks mid-sentence) is said as is, with or without a model.
  if (p.opening?.trim()) return { text: sayable(p.opening), revealed: guessRevealed(p.opening, factCards(p)) };
  return mockOpening(p);
}

export async function callerReply(p: Persona, history: CallLine[], operatorText: string, gender: Gender = null): Promise<CallerReply> {
  const cards = factCards(p);
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(p, cards, gender) },
    ...toMessages(history),
    { role: "user", content: operatorText },
  ];
  const line = await modelLine(messages, cards, () => asJson(mockReply(p, history, operatorText, gender)));
  if (line) {
    const topics = askedTopics(operatorText);
    const asked = topics.includes("addressExact") ? ["addressExact"] : topics.includes("address") ? ["address"] : [];
    for (const topic of ["name", "phone", "status"] as const) if (topics.includes(topic)) asked.push(topic);
    // The model may omit its metadata entirely. Direct answers to critical questions must still match the ticket.
    if (asked.some((key) => {
      const fact = cards.find((c) => c.key === key);
      return fact && !spokenMatchesFact(fact, line.text);
    })) return mockReply(p, history, operatorText, gender);
  }
  return line ?? mockReply(p, history, operatorText, gender);
}

export function cleanCallerReply(out: { reply: string; revealed?: string[] }, cards: FactCard[]): CallerReply {
  const keys = new Set(cards.map((c) => c.key));
  // Said aloud, so no written shorthand: a model still writes «ул.» and «д.» now and then.
  const text = sayable(out.reply.replace(/^\s*["«]|["»]\s*$/g, ""));
  // A model that ignored the «revealed» field gets its disclosures guessed from the words it used.
  if (!out.revealed) return { text, revealed: guessRevealed(text, cards) };
  const groups = new Set(cards.map((c) => c.group).filter(Boolean));
  const claimed = expandRevealed([...out.revealed, ...guessRevealed(text, cards)].filter((k) => keys.has(k) || groups.has(k)), cards);
  // The model may label a fact it did not say, or speak a different value. Use the rule-based caller for that turn.
  if (claimed.some((key) => {
    const fact = cards.find((c) => c.key === key);
    return fact?.expect && !spokenMatchesFact(fact, text);
  })) throw new Error("caller reply contradicts its disclosed facts");
  return { text, revealed: claimed };
}

/** A claimed disclosure can affect grading only when its reference value is audible in that line. */
export function spokenMatchesFact(fact: FactCard, line: string): boolean {
  const t = low(line).replace(/ё/g, "е");
  const e = fact.expect;
  if (!e) return true;
  if (e.kind === "name") {
    const [surname, given] = low(fact.text).replace(/ё/g, "е").split(/\s+/);
    const words = t.split(/[^а-яa-z-]+/);
    return Boolean(surname && given && words.some((w, i) => w === surname && words[i + 1] === given));
  }
  if (e.kind === "phone") {
    const expected = fact.text.replace(/\D/g, "").slice(-10);
    return expected.length === 10 && line.replace(/\D/g, "").includes(expected);
  }
  if (e.kind === "address") {
    const reference = low(sayable(fact.text)).replace(/ё/g, "е");
    const words = reference.split(/[^а-яa-z0-9]+/).filter((w) =>
      w.length >= 5 && !/^(номер|улица|улице|город|москва|дома|домом|знаю|рядом|точно|строение|километр|километра|километре)$/.test(w));
    const numbers = reference.match(/\d+/g) ?? [];
    return words.every((w) => t.includes(w.slice(0, 5))) &&
      numbers.every((n) => new RegExp(`(^|\\D)${n}(\\D|$)`).test(t)) &&
      words.length + numbers.length > 0;
  }
  if (e.kind === "status") {
    const role = low(fact.text).replace(/ё/g, "е").split(/[^а-я]+/).find((w) => w.length >= 4);
    return Boolean(role && t.includes(role.slice(0, Math.min(5, role.length))));
  }
  if (e.kind === "flag") {
    if (!evidenced(fact, line)) return false;
    const negative = e.flag === "gas" ? /нет газа|газа нет|без газа|электроплит|не газиф/
      : e.flag === "victims" ? /пострадавших нет|пострадавших не видит|никто не пострадал|без пострадавш/ : null;
    if (negative?.test(t)) return e.value === false;
    if (e.flag === "gas" && /газиф|газ есть|газ проведен/.test(t)) return e.value === true;
    if (e.flag === "victims" && /есть(?: [а-я]+){0,3} пострадавш|пострадавшие есть|человек пострадал|ранен|травм/.test(t)) return e.value === true;
    if (e.flag === "gas" || e.flag === "victims") return false; // polarity not clear enough for grading
  }
  return evidenced(fact, line);
}

/** Fallback when the model does not list what it said: distinctive words of a fact in the reply. */
function guessRevealed(text: string, cards: FactCard[]): string[] {
  const t = low(text);
  return cards
    .filter((c) => {
      const words = low(c.text)
        .split(/[^а-яa-z0-9]+/)
        .filter((w) => w.length >= 5 || /^\d{2,}$/.test(w));
      if (!words.length) return false;
      const hits = words.filter((w) => t.includes(w.slice(0, Math.max(4, w.length - 2)))).length;
      return hits >= Math.min(2, words.length) && spokenMatchesFact(c, text);
    })
    .map((c) => c.key);
}

// ─── Rule-based caller (no model) ────────────────────────────────────────────

const firstSentence = (s: string) => (s.match(/^[^.!?]+[.!?]?/)?.[0] ?? s).trim();
/** «Горит балкон!» → «горит балкон»: a sentence folded into «Я же говорю — …». */
function folded(s: string): string {
  const t = s.trim().replace(/[.!?…]+$/, "");
  return /^\p{Lu}\p{Ll}/u.test(t) ? t[0].toLowerCase() + t.slice(1) : t;
}

/**
 * The first words when the operator picks up: a short «Алло…» by temper and nothing about what happened — a
 * person first wants to hear that they got through. The story comes in the next line, after the operator's
 * greeting or first question. Said by rules in both modes: instant, repeatable, no model call.
 */
export function greetingLine(p: Persona): string {
  switch (p.temper) {
    case "panic":
      return "Алло! Алло, это 112?!";
    case "elderly":
      return "Алло… Алло, это сто двенадцать?";
    case "child":
      return "Алло… Алло? Это сто двенадцать?";
    case "angry":
      return "Да, алло! Это 112?";
    case "drunk":
      return "Алло… Это… сто двенадцать, да?";
    default:
      return "Алло, здравствуйте…";
  }
}

/**
 * The story, the first time it is told: here the manner shows most. «Сынок» / «Дочка», «Дядя» / «Тётя» only when
 * the operator's gender is known.
 */
function storyStyled(p: Persona, text: string, gender: Gender): string {
  switch (p.temper) {
    case "panic":
      return `Помогите! ${text} Быстрее, пожалуйста!`;
    case "elderly": {
      const who = gender === "male" ? "Сынок" : gender === "female" ? "Дочка" : "";
      return `${who ? `${who}, тут` : "Тут"} такое… ${text}`;
    }
    case "child": {
      const who = gender === "male" ? "Дядя, помогите" : gender === "female" ? "Тётя, помогите" : "Помогите";
      return `${who}… ${text}`;
    }
    case "angry":
      return `${text} Давайте быстрее уже!`;
    case "drunk":
      return `Тут это… ${text}`;
    default:
      return text;
  }
}

/**
 * The manner in later replies. `turn` — which reply this is (1 — the story): the manner shows now and then, not in
 * every line («Ой…» once, «Быстрее!» every other reply).
 */
function styled(p: Persona, text: string, turn: number): string {
  switch (p.temper) {
    case "panic":
      return turn >= 3 && turn % 2 === 1 ? `${text.replace(/\.$/, "")}${/[!?…]$/.test(text) ? "" : "!"} Быстрее!` : text;
    case "elderly":
      return turn === 2 ? `Ой… ${text}` : text;
    case "angry":
      return turn >= 3 && turn % 2 === 1 ? `${text} Сколько можно спрашивать?` : text;
    default:
      return text;
  }
}

/**
 * A question about what the caller has already said: a short «Я же говорю — …», not the same words again.
 * `sentence` — a sentence of the story or a fact, folded after the dash; an address or a name stays as it is.
 */
function again(p: Persona, text: string, sentence: boolean): string {
  const x = sentence ? folded(text) : text.trim().replace(/[.!?…]+$/, "");
  switch (p.temper) {
    case "panic":
      return `Я же говорю — ${x}!`;
    case "angry":
      return `Я же уже говорил${p.voice === "male" ? "" : "а"}: ${x}!`;
    case "elderly":
      return `Я ж говорю… ${x}.`;
    case "child":
      return `Я же говорю… ${x}…`;
    case "drunk":
      return `Ну я ж говорю… ${x}.`;
    default:
      return sentence ? `Я же говорю — ${x}.` : `Повторяю: ${x}.`;
  }
}

/** First words when the operator picks up, by rules: the greeting only. */
export function mockOpening(p: Persona): CallerReply {
  return { text: greetingLine(p), revealed: [] };
}

/** Ticket facts the caller's own words already contain (the situation often names a few). */
function factsIn(text: string, cards: FactCard[]): string[] {
  return guessRevealed(text, cards.filter((c) => c.group));
}

const UNKNOWN: Partial<Record<FactTopic, string>> = {
  victims: "Не знаю, отсюда не видно.",
  gas: "Не знаю про газ.",
  floors: "Не считал(а) этажи, не знаю.",
  access: "Не знаю, не проверял(а).",
  threat: "Не знаю.",
  fire: "Не могу сказать.",
  consciousness: "Не знаю.",
  age: "Не знаю точно.",
  breathing: "Не могу понять.",
  weapon: "Оружия не видел.",
  people: "Точно не скажу.",
  object: "Не разглядел(а).",
};

const TOPIC_ORDER: FactTopic[] = [
  "what",
  "addressExact",
  "address",
  "name",
  "status",
  "phone",
  "victims",
  "people",
  "fire",
  "floors",
  "gas",
  "access",
  "threat",
  "consciousness",
  "breathing",
  "age",
  "weapon",
  "object",
];

/** Topics whose words are names and numbers: repeated as they are («Повторяю: …»), not folded into a sentence. */
const AS_IS: FactTopic[] = ["address", "addressExact", "name", "phone"];

export function mockReply(p: Persona, history: CallLine[], operatorText: string, gender: Gender = null): CallerReply {
  const cards = factCards(p);
  // Which reply this is: the greeting was the caller's first line, the story comes in the first reply.
  const turn = Math.max(1, history.filter((m) => m.role === "counterpart" && !m.noise).length);
  const said = new Set(history.flatMap((m) => m.revealed ?? []));
  const saidWords = low(history.filter((m) => m.role === "counterpart").map((m) => m.text).join("\n"));
  const told = said.has("situation");
  let topics = askedTopics(operatorText);
  const t = low(operatorText);

  // A second question about the address is a clarification: now the caller gives the exact place.
  if (topics.includes("address") && !topics.includes("addressExact") && said.has("address") && p.hiddenAddress) {
    topics = [...topics.filter((x) => x !== "address"), "addressExact"];
  }
  if (topics.includes("addressExact") && !p.hiddenAddress && !topics.includes("address")) topics.push("address");
  if (topics.includes("addressExact") && p.hiddenAddress) topics = topics.filter((x) => x !== "address");

  const story = firstSentence(speech(p.situation));
  const parts: string[] = [];
  const repeats: { text: string; sentence: boolean }[] = [];
  const unknown: string[] = [];
  const revealed: string[] = [];
  // What happened comes first, whatever the operator asked: a caller who got through tells the trouble.
  if (!told) revealed.push("situation", ...factsIn(story, cards));
  const say = (card: FactCard | undefined, text?: string) => {
    if (!card) return;
    const line = sayable(text ?? card.text);
    revealed.push(card.key);
    // Said before: not the same words again, but «Я же говорю — …».
    if (said.has(card.key)) {
      if (!repeats.some((r) => r.text === line)) repeats.push({ text: line, sentence: !AS_IS.includes(card.topic) });
    } else if (!parts.includes(line)) parts.push(line);
  };
  const byKey = (k: string) => cards.find((c) => c.key === k);

  for (const topic of TOPIC_ORDER.filter((x) => topics.includes(x))) {
    if (topic === "what") {
      if (!told) continue;
      // Asked again: the rest of the story if it has not been said yet, else a short reminder.
      const full = speech(p.situation);
      const rest = full.slice(firstSentence(full).length).trim();
      if (rest && !saidWords.includes(low(firstSentence(rest)).replace(/[.!?…]+$/, ""))) {
        parts.push(rest[0].toUpperCase() + rest.slice(1));
        revealed.push("situation", ...factsIn(rest, cards));
      } else repeats.push({ text: story, sentence: true });
    }
    else if (topic === "address") say(byKey("address"), p.visibleAddress);
    else if (topic === "addressExact") say(byKey("addressExact") ?? byKey("address"), p.hiddenAddress ? `Сейчас… точнее так: ${p.hiddenAddress}` : p.visibleAddress);
    else if (topic === "name") say(byKey("name"), `${p.fullName}.`);
    else if (topic === "phone") say(byKey("phone"), p.phone ? `Мой номер ${p.phone}.` : undefined);
    else if (topic === "status") say(byKey("status"), `Я ${p.role}.`);
    else {
      const facts = cards.filter((c) => c.topic === topic);
      if (facts.length) facts.forEach((f) => say(f));
      else if (UNKNOWN[topic]) unknown.push(UNKNOWN[topic]!);
    }
  }
  // A question no topic covers («Какой номер маршрута?»): the ticket line with the same words.
  if (!parts.length && !repeats.length && !unknown.length) {
    const hit = bestFactByWords(operatorText, cards);
    if (hit) say(hit);
  }
  const keys = () => expandRevealed([...new Set(revealed)], cards);

  if (!told) {
    // The story, and the answer to the question if there was one; «не знаю» fits after it too.
    const answer = parts.length || repeats.length ? [...parts, ...repeats.map((r) => r.text)] : unknown;
    return { text: storyStyled(p, sentences([story, ...answer]), gender), revealed: keys() };
  }
  if (parts.length) return { text: styled(p, sentences([...parts, ...repeats.map((r) => r.text)]), turn), revealed: keys() };
  if (repeats.length) {
    const [first, ...others] = repeats;
    return { text: sentences([again(p, first.text, first.sentence), ...others.map((r) => r.text)]), revealed: keys() };
  }
  // «Не знаю» only when nothing else was said: a caller does not mix it into a real answer.
  if (unknown.length) return { text: styled(p, sentences(unknown), turn), revealed: [] };
  if (/выезжа|выехал|направ|высыла|передал|будут|едут|ожидайте|помощь (уже )?едет/.test(t)) {
    return { text: p.temper === "panic" ? "Спасибо! Только быстрее!" : "Спасибо, ждём.", revealed: [] };
  }
  if (/алло|слышите|слышно/.test(t)) return { text: "Да-да, слышу!", revealed: [] };
  // The operator greets again or says «слушаю»: the trouble once more, in short.
  if (/112|слушаю|здравствуйте|говорите/.test(t)) return { text: again(p, story, true), revealed: [] };
  const filler: Record<string, string> = {
    panic: "Я не понимаю, что вы спрашиваете! Приезжайте!",
    elderly: "Что? Не расслышала, повторите, пожалуйста.",
    child: "Я не знаю…",
    angry: "Вы о чём вообще? Приезжайте уже!",
    drunk: "А? Ну… приезжайте, короче.",
  };
  return { text: filler[p.temper ?? ""] ?? "Не поняла вопрос. Что мне сказать?", revealed: [] };
}

/** Separate facts into sentences: «пострадавших не видит» + «Дом 14 этажей» → «…не видит. Дом 14 этажей». */
function sentences(parts: string[]): string {
  return parts
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (/[.!?…]$/.test(s) ? s : `${s}.`))
    .join(" ");
}
