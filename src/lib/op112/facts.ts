/**
 * What the caller knows, what the operator asks, and how a said fact must show up in the card.
 * Shared by the rule-based caller (no model) and the «сказал ↔ заполнил» checks.
 * Ticket facts are free text («Дом 14 этажей, газифицирован»): one line may hold several facts.
 */
import type { CallerPersona, CallerStatus } from "@/lib/incident/types";
import { CALLER_STATUSES } from "@/lib/incident/types";
import type { FactCard, FactExpectation, FactTopic, RequiredQuestion } from "./types";

type Topic = Exclude<FactTopic, "other">;

/** Operator phrases that ask about a topic. Checked against lower-cased text with «ё» → «е». */
const ASK: Record<Topic, RegExp> = {
  what: /что (у вас )?(случилось|произошло|горит|именно|видите|там)|что с (ним|ней)|опишите|что за/,
  address: /адрес|улиц|где (вы|это|именно|находит|случил|произош|горит)|куда (ехать|подъехать|направить)|ориентир|район/,
  addressExact: /номер дома|какой дом|точн[а-яa-z]* адрес|уточн[а-яa-z]*( адрес)?|дом(а)? номер|корпус|строени|подъезд|рядом с чем|какой номер|напротив чего|что рядом|где именно|код домофона/,
  name: /зовут|ваше имя|фамили|фио|представ|как к вам обращ|ваши (фио|данные)|кто (вы|звонит|говорит)/,
  phone: /телефон|номер для связи|перезвонить|контактн/,
  status: /кем (вы|приход)|вы (сами )?(пострадав|очевид|родствен|участник|житель|хозя)|вы (там|на месте|рядом)|кто вы (ему|ей)/,
  victims: /пострадав|ранен|травм|жертв|живы|кто-(то|нибудь) (есть|внутри|пострадал)|люди (есть|внутри|в доме|в квартире|в автобусе|в машине)|есть ли люди|нужна (ли )?скорая|медицинск|состояние/,
  gas: /газ/,
  floors: /этаж/,
  access: /доступ|проехать|подъехать|проезд|ворота|шлагбаум|заблокир|открыт[а-яa-z]* (дверь|подъезд)|попасть/,
  threat: /угроз|угрожа|опасн|распростран|перекин|соседн|эвакуац/,
  fire: /пламя|огонь|открыт[а-яa-z]* огонь|дым|задымл|гарь|гари/,
  consciousness: /созна|реагир|отвеча[а-яa-z]* ли/,
  age: /возраст|сколько (ему|ей|лет)|лет (ему|ей)/,
  breathing: /дыш/,
  weapon: /оруж|вооруж|нож|бит[аыу]|пистолет|стреля/,
  people: /сколько (человек|людей|их|участник)|сколько народ/,
  object: /предмет|как выглядит|приметы|марк[а-яa-z]* (машин|автомоб)|номер (машин|автомоб|маршрут)|бортов|госномер/,
};

export const TOPIC_LABEL: Record<FactTopic, string> = {
  what: "что случилось",
  address: "адрес",
  addressExact: "уточнённый адрес",
  name: "ФИО заявителя",
  phone: "телефон",
  status: "статус заявителя",
  victims: "пострадавшие",
  gas: "газ",
  floors: "этажность",
  access: "доступ",
  threat: "угроза людям",
  fire: "пламя, дым",
  consciousness: "сознание",
  age: "возраст",
  breathing: "дыхание",
  weapon: "оружие",
  people: "сколько людей",
  object: "приметы",
  other: "прочее",
};

export const low = (s: string) => s.toLowerCase().replace(/ё/g, "е");

export function askedTopics(operatorText: string): FactTopic[] {
  const t = low(operatorText);
  return (Object.keys(ASK) as Topic[]).filter((k) => ASK[k].test(t));
}

// ─── Word stems for free-text matching ───────────────────────────────────────

const STOP = new Set(
  "есть ли или и а но не нет да на в во с со к ко по за из от до о об для при что как где кто это его ее их все всё уже еще ещё только если чтобы уточнить уточните первый ответ заявителя заявитель неполный неточный нужна нужно надо".split(
    " ",
  ),
);

/** Content words cut to their first letters: «маршрута» and «маршрут» meet at «марш». */
export function stems(text: string): string[] {
  return low(text)
    .split(/[^а-яa-z0-9]+/)
    .filter((w) => w.length >= 4 && !STOP.has(w))
    .map((w) => w.slice(0, 4));
}

function shareStems(a: string[], b: string[]): number {
  const set = new Set(b);
  return [...new Set(a)].filter((s) => set.has(s)).length;
}

// ─── Required questions ──────────────────────────────────────────────────────

/** Topics a required question is about: «ФИО и статус заявителя, контактный телефон» → name, status, phone. */
export function questionTopics(text: string): FactTopic[] {
  const t = low(text);
  const out: FactTopic[] = [];
  const add = (x: FactTopic) => !out.includes(x) && out.push(x);
  if (/адрес|улиц|номер дома|строени|ориентир|где именно|вход/.test(t)) add(/уточн|номер дома|строени|где именно|ориентир|вход/.test(t) ? "addressExact" : "address");
  if (/фио|фамили|имя/.test(t)) add("name");
  if (/статус/.test(t)) add("status");
  if (/телефон/.test(t)) add("phone");
  for (const k of ["gas", "floors", "victims", "access", "threat", "fire", "consciousness", "age", "breathing", "weapon", "people", "object"] as Topic[]) {
    if (ASK[k].test(t)) add(k);
  }
  if (/сколько (людей|человек)|люди в|людей в опасности/.test(t)) add("people");
  return out;
}

export function normalizeQuestion(q: RequiredQuestion | string): RequiredQuestion {
  const item = typeof q === "string" ? { text: q } : q;
  if (item.topic || item.keywords?.length) return item;
  return { ...item, topic: questionTopics(item.text)[0] ?? "other" };
}

/**
 * Was the question asked? By topic (the operator's words match any topic of the question) or,
 * for questions no topic covers («Номер маршрута и бортовой номер»), by shared content words.
 * Returns the operator line that asked it.
 */
export function findAsked(q: RequiredQuestion, operatorLines: string[]): string | undefined {
  if (q.keywords?.length) {
    const res = q.keywords.map((k) => new RegExp(k, "i"));
    return operatorLines.find((l) => res.some((re) => re.test(low(l))));
  }
  const topics = [...new Set([...(q.topic && q.topic !== "other" ? [q.topic] : []), ...questionTopics(q.text)])].filter(
    (t): t is Topic => t !== "other",
  );
  const byTopic = operatorLines.find((l) => topics.some((t) => ASK[t].test(low(l))));
  if (byTopic) return byTopic;
  const qs = stems(q.text);
  if (!qs.length) return undefined;
  const need = qs.length >= 3 ? 2 : 1;
  return operatorLines.find((l) => shareStems(qs, stems(l)) >= need);
}

export function askedAbout(topic: FactTopic, operatorLines: string[], keywords?: string[]): boolean {
  const res = keywords?.length ? keywords.map((k) => new RegExp(k, "i")) : topic === "other" ? [] : [ASK[topic]];
  return operatorLines.some((line) => res.some((re) => re.test(low(line))));
}

// ─── Ticket facts ────────────────────────────────────────────────────────────

/** Topics a ticket fact speaks about; «Дом 14 этажей, газифицирован» → floors and gas. */
export function topicsOfFact(text: string): Topic[] {
  const t = low(text);
  const out: Topic[] = [];
  if (/газ(?!ел)|газиф|магистрал|баллон/.test(t)) out.push("gas");
  if (/\d+\s*-?\s*(этаж|эт(?![а-я]))|этажн[а-яa-z]*\s*[-–—:]?\s*\d/.test(t)) out.push("floors");
  if (/пострадав|ранен|травм|ожог|кров|зовут на помощь|кричат о помощи|без сознан/.test(t)) out.push("victims");
  if (/сознани|без сознан/.test(t)) out.push("consciousness");
  if (/доступ|заблок|ворота|не открыва|закрыт/.test(t)) out.push("access");
  if (/угроз|угрожа|перекидыва|распростран|зовут на помощь|кричат/.test(t)) out.push("threat");
  if (/пламя|огонь|огня|(^|[^а-я])дым|задымл|гари|горит|горят/.test(t)) out.push("fire");
  if (/\d+\s*(лет|год)/.test(t)) out.push("age");
  if (/дыш/.test(t)) out.push("breathing");
  if (/оруж|бит[аыу]|нож|палк|вооруж/.test(t)) out.push("weapon");
  if (/\d+\s*(человек|мужчин|женщин)|двое|трое|группа|\d+[–-]\d+ (человек|молод)/.test(t)) out.push("people");
  if (/коробк|сумк|предмет|маршрут|бортов|госномер|номер [а-я]\s?\d|марк|цвет/.test(t)) out.push("object");
  return out;
}

/** Back-compat for callers that need one topic. */
export function topicOfFact(text: string): FactTopic {
  return topicsOfFact(text)[0] ?? "other";
}

/** What the caller says out loud: the ticket's notes for the trainer are cut off. */
export function spokenFact(text: string): string {
  return text
    .replace(/\s*\([^)]*(вопрос|сообща|уточн|только|знает)[^)]*\)/gi, "")
    .replace(/[;,.]?\s*при уточнении\s*[—:-].*$/i, "")
    .replace(/^(точный адрес знает только если спросить|при уточнении)\s*[:—-]\s*/i, "")
    .replace(/не знает/gi, "не знаю")
    .replace(/\s+/g, " ")
    .trim();
}

/** How the card must reflect a fact of this topic once the caller has said it. */
export function expectationOfFact(topic: FactTopic, text: string): FactExpectation | undefined {
  const t = low(text);
  switch (topic) {
    case "gas":
      if (/не знает|не знаю|неизвест/.test(t)) return undefined;
      if (/магистрал/.test(t)) return { kind: "tag", row: "Газ магистральный или баллон", value: "Магистральный" };
      if (/баллон/.test(t)) return { kind: "tag", row: "Газ магистральный или баллон", value: "Баллон" };
      if (/не газифиц|газа нет|газа в [а-я ]+ нет|нет газа|без газа|электроплит/.test(t)) return { kind: "flag", flag: "gas", value: false };
      if (/газифиц|газовые плиты|плиты газовые/.test(t)) return { kind: "flag", flag: "gas", value: true };
      return undefined;
    case "floors": {
      const n = /(\d+)\s*-?\s*(этаж|эт(?![а-я]))/.exec(t) ?? /этажн[а-я]*\s*[-–—:]?\s*(\d+)/.exec(t);
      return n ? { kind: "tag", row: "Этажность здания", value: n[1] } : undefined;
    }
    case "victims":
      if (/других пострадавш/.test(t)) return undefined;
      if (/пострадавш[^.,;]*\sнет|нет пострадавш|никто не пострадал|не пострадал|пострадавш[а-яa-z]*\s+не\s+(вид|было|знает)|без пострадавш/.test(t)) {
        return { kind: "flag", flag: "victims", value: false };
      }
      return { kind: "flag", flag: "victims", value: true };
    case "access":
      if (/не заблок/.test(t)) return { kind: "flag", flag: "noAccess", value: false };
      if (/доступ есть|открыт/.test(t) && !/не открыва/.test(t)) return undefined;
      return { kind: "flag", flag: "noAccess", value: true };
    case "threat":
      if (/угроз[^.,;]* нет|нет угроз|не угрожа/.test(t)) return { kind: "flag", flag: "threat", value: false };
      return { kind: "flag", flag: "threat", value: true };
    case "consciousness":
      return { kind: "description", keywords: ["сознан"] };
    case "age": {
      const n = /(\d+)\s*(лет|год)/.exec(t);
      return n ? { kind: "description", keywords: [n[1]] } : undefined;
    }
    default:
      return undefined;
  }
}

/** Map the ticket role («мама», «сосед», «работник АЗС») to one of the 6 caller statuses; unclear roles → none. */
export function statusOfRole(role: string | undefined): CallerStatus | undefined {
  const r = low(role ?? "");
  if (!r) return undefined;
  if ((CALLER_STATUSES as readonly string[]).includes(r)) return r as CallerStatus;
  if (/ребен|ребён|школьн/.test(r)) return "ребёнок";
  if (/мама|папа|мать|отец|муж|жена|супруг|сын|дочь|брат|сестр|бабушк|дедушк|родств|внук|внучк/.test(r)) return "родственник";
  if (/сосед|знаком|друг|подруг|коллег/.test(r)) return "знакомый";
  if (/пострадав|сам себе|вызывает себе/.test(r)) return "пострадавший";
  if (/водител|участник/.test(r)) return "участник";
  if (/житель|хозя|владел|работник|сотрудник/.test(r)) return undefined;
  return "очевидец";
}

type PersonaExtra = CallerPersona & { factCards?: FactCard[] };

/** Everything the caller may reveal, with the card field each fact must land in. */
export function factCards(persona: PersonaExtra): FactCard[] {
  const cards: FactCard[] = [
    { key: "situation", topic: "what", text: persona.situation, label: "что случилось" },
    { key: "address", topic: "address", text: persona.visibleAddress, label: "адрес со слов заявителя", expect: { kind: "address" } },
  ];
  if (persona.hiddenAddress) {
    cards.push({ key: "addressExact", topic: "addressExact", text: persona.hiddenAddress, label: "уточнённый адрес", expect: { kind: "address" } });
  }
  cards.push({ key: "name", topic: "name", text: persona.fullName, label: "ФИО заявителя", expect: { kind: "name" } });
  const status = statusOfRole(persona.role);
  cards.push({ key: "status", topic: "status", text: persona.role, label: "статус заявителя", expect: status ? { kind: "status", value: status } : undefined });
  if (persona.phone) cards.push({ key: "phone", topic: "phone", text: persona.phone, label: "телефон", expect: { kind: "phone" } });

  if (persona.factCards?.length) {
    // Detailed facts from a scenario editor: a card with a default key («situation», «address»…) replaces it.
    for (const f of persona.factCards) {
      const card = { ...f, label: f.label || TOPIC_LABEL[f.topic] };
      const i = cards.findIndex((c) => c.key === f.key);
      if (i >= 0) cards[i] = { ...cards[i], ...card };
      else cards.push(card);
    }
    return cards;
  }
  (persona.facts ?? []).forEach((raw, i) => {
    const group = `fact${i + 1}`;
    const text = spokenFact(raw);
    if (!text) return;
    const topics = topicsOfFact(raw);
    if (!topics.length) {
      cards.push({ key: group, topic: "other", text, label: TOPIC_LABEL.other, group });
      return;
    }
    topics.forEach((topic, j) => {
      cards.push({ key: j === 0 ? group : `${group}.${topic}`, topic, text, label: TOPIC_LABEL[topic], expect: expectationOfFact(topic, raw), group });
    });
  });
  return cards;
}

/** Revealing one fact of a ticket line reveals the whole line. */
export function expandRevealed(keys: string[], cards: FactCard[]): string[] {
  const groups = new Set(cards.filter((c) => keys.includes(c.key) && c.group).map((c) => c.group));
  return [...new Set([...keys, ...cards.filter((c) => c.group && groups.has(c.group)).map((c) => c.key)])];
}

/** The fact whose words best match a question no topic covered («Какой номер маршрута?»). */
export function bestFactByWords(question: string, cards: FactCard[]): FactCard | undefined {
  const qs = stems(question);
  let best: FactCard | undefined;
  let score = 0;
  for (const c of cards) {
    if (!c.group) continue;
    const s = shareStems(qs, stems(c.text));
    if (s > score) {
      best = c;
      score = s;
    }
  }
  return best;
}
