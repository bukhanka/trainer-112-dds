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
import { askedTopics, factCards, low } from "./facts";
import type { CallLine, FactCard, FactTopic } from "./types";

export type Persona = CallerPersona & { factCards?: FactCard[] };
export type CallerReply = { text: string; revealed: string[] };

const TEMPER: Record<NonNullable<CallerPersona["temper"]>, string> = {
  calm: "Говоришь спокойно и по делу, но сам разговор не ведёшь — ждёшь вопросов.",
  panic:
    "Ты напуган и торопишься: короткие фразы, повторяешь «быстрее», можешь сбиться. На прямой вопрос всё же отвечаешь, пусть и не с первого раза.",
  elderly:
    "Ты пожилой человек: говоришь медленно, иногда переспрашиваешь, обращаешься к оператору «сынок» или «дочка», путаешься в новых названиях.",
  child:
    "Тебе около десяти лет: говоришь просто, боишься, взрослых подробностей (номер дома, этажность, газ) можешь не знать — тогда так и скажи.",
  drunk: "Ты выпил: отвечаешь не сразу и не всегда по вопросу, но то, что знаешь, говоришь верно.",
  angry: "Ты раздражён, что тебя долго расспрашивают, но на вопросы отвечаешь.",
};

function systemPrompt(p: Persona, cards: FactCard[]): string {
  const facts = cards
    .filter((c) => !["situation", "address", "addressExact", "name", "status", "phone"].includes(c.key))
    .map((c) => `- [${c.key}] ${c.text}`)
    .join("\n");
  return [
    "Это учебный тренажёр службы 112. Ты играешь заявителя — человека, который сам позвонил на 112. На линии обучающийся оператор, он заполняет карточку происшествия по твоим словам.",
    "",
    `Кто ты: ${p.fullName}, ${p.role}. Голос ${p.voice === "male" ? "мужской" : "женский"}.`,
    TEMPER[p.temper ?? "calm"],
    "",
    `[situation] Что случилось, твоими словами: ${p.situation}`,
    `[address] Место ты называешь так: «${p.visibleAddress}».`,
    p.hiddenAddress
      ? `[addressExact] Точное место ты знаешь: «${p.hiddenAddress}». Сам его не называй. Скажи его только тогда, когда оператор просит уточнить адрес: номер дома, корпус, ориентир, «где именно», «что рядом».`
      : "",
    `[name] Твоё имя — называй, если спросят, как тебя зовут.`,
    `[status] Кем ты приходишься происшествию: ${p.role}.`,
    p.phone ? `[phone] Твой телефон ${p.phone} — называй, если спросят номер для связи.` : "",
    "",
    facts ? `Что ещё ты знаешь. Говори это только в ответ на вопрос о том же, по одному факту за раз:\n${facts}` : "",
    "",
    "Как отвечать:",
    "1. Одна-две короткие фразы, как в живом звонке. Без ремарок в скобках, звёздочек и описания действий.",
    "2. Отвечай только на то, что спросили. Сам всё сразу не выкладывай.",
    "3. Чего в твоих сведениях нет — не выдумывай: «не знаю», «отсюда не видно».",
    "4. Не выходи из роли, не называй себя программой, не подсказывай оператору, что ему делать.",
    "5. Если оператор говорит не по делу, верни разговор к своей беде. Если сказал, что помощь едет, — коротко поблагодари.",
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

/** First words when the operator picks up. */
export async function callerOpening(p: Persona): Promise<CallerReply> {
  const mock = () => asJson(mockOpening(p));
  const cards = factCards(p);
  try {
    const out = await chatJson(
      [
        { role: "system", content: systemPrompt(p, cards) },
        { role: "user", content: "(Оператор снял трубку: «Служба 112, здравствуйте».) Скажи первую фразу: кратко, что случилось." },
      ],
      replySchema,
      { temperature: 0.7, maxTokens: 200, mock },
    );
    return clean(out, cards);
  } catch {
    return mockOpening(p);
  }
}

export async function callerReply(p: Persona, history: CallLine[], operatorText: string): Promise<CallerReply> {
  const cards = factCards(p);
  const mock = () => asJson(mockReply(p, history, operatorText));
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt(p, cards) },
    ...toMessages(history),
    { role: "user", content: operatorText },
  ];
  try {
    const out = await chatJson(messages, replySchema, { temperature: 0.6, maxTokens: 250, mock });
    return clean(out, cards);
  } catch {
    // A model that cannot do JSON still gets a plain reply; disclosed facts are then guessed.
    try {
      const text = await chat(messages, { temperature: 0.6, maxTokens: 200, mock: () => mockReply(p, history, operatorText).text });
      return { text, revealed: guessRevealed(text, cards) };
    } catch {
      return mockReply(p, history, operatorText);
    }
  }
}

function clean(out: { reply: string; revealed?: string[] }, cards: FactCard[]): CallerReply {
  const keys = new Set(cards.map((c) => c.key));
  const text = out.reply.replace(/^\s*["«]|["»]\s*$/g, "").trim();
  // A model that ignored the «revealed» field gets its disclosures guessed from the words it used.
  if (!out.revealed) return { text, revealed: guessRevealed(text, cards) };
  return { text, revealed: out.revealed.filter((k) => keys.has(k)) };
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
      return hits >= Math.min(2, words.length);
    })
    .map((c) => c.key);
}

// ─── Rule-based caller (no model) ────────────────────────────────────────────

const firstSentence = (s: string) => (s.match(/^[^.!?]+[.!?]?/)?.[0] ?? s).trim();

function styled(p: Persona, text: string, opening = false): string {
  switch (p.temper) {
    case "panic":
      return opening ? `Алло! 112?! ${text} Быстрее, пожалуйста!` : `${text}${/[!?]$/.test(text) ? "" : "!"} Быстрее!`;
    case "elderly":
      return opening ? `Алло… Это сто двенадцать? ${p.voice === "male" ? "Дочка" : "Сынок"}, тут такое… ${text}` : `Ой… ${text}`;
    case "child":
      return opening ? `Алло… Тётя, помогите… ${text}` : text;
    case "angry":
      return opening ? `Да, алло! ${text}` : `${text} Сколько можно спрашивать?`;
    default:
      return opening ? `Здравствуйте. ${text}` : text;
  }
}

export function mockOpening(p: Persona): CallerReply {
  return { text: styled(p, firstSentence(p.situation), true), revealed: ["situation"] };
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
};

const TOPIC_ORDER: FactTopic[] = [
  "what",
  "addressExact",
  "address",
  "name",
  "status",
  "phone",
  "victims",
  "fire",
  "floors",
  "gas",
  "access",
  "threat",
  "consciousness",
  "breathing",
  "age",
];

export function mockReply(p: Persona, history: CallLine[], operatorText: string): CallerReply {
  const cards = factCards(p);
  const said = new Set(history.flatMap((m) => m.revealed ?? []));
  let topics = askedTopics(operatorText);
  const t = low(operatorText);

  // A second question about the address is a clarification: now the caller gives the exact place.
  if (topics.includes("address") && !topics.includes("addressExact") && said.has("address") && p.hiddenAddress) {
    topics = [...topics.filter((x) => x !== "address"), "addressExact"];
  }
  if (topics.includes("addressExact") && !p.hiddenAddress && !topics.includes("address")) topics.push("address");
  if (topics.includes("addressExact") && p.hiddenAddress) topics = topics.filter((x) => x !== "address");

  const parts: string[] = [];
  const revealed: string[] = [];
  const say = (card: FactCard | undefined, text?: string) => {
    if (!card) return;
    parts.push(text ?? card.text);
    revealed.push(card.key);
  };
  const byKey = (k: string) => cards.find((c) => c.key === k);

  for (const topic of TOPIC_ORDER.filter((x) => topics.includes(x))) {
    if (topic === "what") say(byKey("situation"), said.has("situation") ? p.situation : firstSentence(p.situation));
    else if (topic === "address") say(byKey("address"), p.visibleAddress);
    else if (topic === "addressExact") say(byKey("addressExact") ?? byKey("address"), p.hiddenAddress ? `Сейчас… точнее так: ${p.hiddenAddress}` : p.visibleAddress);
    else if (topic === "name") say(byKey("name"), `${p.fullName}.`);
    else if (topic === "phone") say(byKey("phone"), p.phone ? `Мой номер ${p.phone}.` : undefined);
    else if (topic === "status") say(byKey("status"), `Я ${p.role}.`);
    else {
      const facts = cards.filter((c) => c.topic === topic);
      if (facts.length) facts.forEach((f) => say(f));
      else if (UNKNOWN[topic]) parts.push(UNKNOWN[topic]!);
    }
  }

  if (!parts.length) {
    if (/выезжа|выехал|направ|высыла|передал|будут|едут|ожидайте|помощь (уже )?едет/.test(t)) {
      return { text: p.temper === "panic" ? "Спасибо! Только быстрее!" : "Спасибо, ждём.", revealed: [] };
    }
    if (/112|слушаю|здравствуйте|алло/.test(t)) return { text: styled(p, firstSentence(p.situation)), revealed: ["situation"] };
    const filler: Record<string, string> = {
      panic: "Я не понимаю, что вы спрашиваете! Приезжайте!",
      elderly: "Что? Не расслышала, повторите, пожалуйста.",
      child: "Я не знаю…",
      angry: "Вы о чём вообще? Приезжайте уже!",
      drunk: "А? Ну… приезжайте, короче.",
    };
    return { text: filler[p.temper ?? ""] ?? "Не поняла вопрос. Что мне сказать?", revealed: [] };
  }
  return { text: styled(p, parts.join(" ")), revealed: [...new Set(revealed)] };
}
