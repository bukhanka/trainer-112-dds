/**
 * What the caller knows, what the operator asks, and how a said fact must show up in the card.
 * Shared by the rule-based caller (mock mode) and the «сказал ↔ заполнил» checks.
 */
import type { CallerPersona, CallerStatus } from "@/lib/incident/types";
import { CALLER_STATUSES } from "@/lib/incident/types";
import type { FactCard, FactExpectation, FactTopic, RequiredQuestion } from "./types";

/** Operator phrases that ask about a topic. Checked against lower-cased text with «ё» → «е». */
const ASK: Record<Exclude<FactTopic, "other">, RegExp> = {
  what: /что (у вас )?(случилось|произошло|горит|именно|видите|там)|что с (ним|ней)|опишите/,
  address: /адрес|улиц|где (вы|это|именно|находит|случил|произош|горит)|куда (ехать|подъехать|направить)|ориентир|район/,
  addressExact: /номер дома|какой дом|точн\w* адрес|уточн\w*( адрес)?|дом(а)? номер|корпус|строени|подъезд|рядом с чем|какой номер|напротив чего|что рядом/,
  name: /зовут|ваше имя|фамили|представ|как к вам обращ|ваши (фио|данные)|кто (вы|звонит|говорит)/,
  phone: /телефон|номер для связи|перезвонить|контактн/,
  status: /кем (вы|приход)|вы (сами )?(пострадав|очевид|родствен|участник)|вы (там|на месте|рядом)|кто вы (ему|ей)|вы видите/,
  victims: /пострадав|ранен|травм|жертв|живы|кто-(то|нибудь) (есть|внутри|пострадал)|люди (есть|внутри|в доме|в квартире)|есть ли люди|нужна (ли )?скорая|медицинск/,
  gas: /газ/,
  floors: /этаж/,
  access: /доступ|проехать|подъехать|проезд|ворота|шлагбаум|заблокир|открыт\w* (дверь|подъезд)|попасть/,
  threat: /угроз|опасн|распростран|перекин|соседн/,
  fire: /пламя|огонь|открыт\w* огонь|дым|задымл/,
  consciousness: /созна|реагир|отвеча\w* ли/,
  age: /возраст|сколько (ему|ей|лет)|лет (ему|ей)/,
  breathing: /дыш/,
};

export const TOPIC_LABEL: Record<FactTopic, string> = {
  what: "что случилось",
  address: "адрес",
  addressExact: "уточнённый адрес",
  name: "ФИО заявителя",
  phone: "телефон",
  status: "статус заявителя",
  victims: "пострадавшие",
  gas: "газификация",
  floors: "этажность",
  access: "доступ",
  threat: "угроза людям",
  fire: "открытое пламя",
  consciousness: "сознание",
  age: "возраст",
  breathing: "дыхание",
  other: "прочее",
};

export const low = (s: string) => s.toLowerCase().replace(/ё/g, "е");

export function askedTopics(operatorText: string): FactTopic[] {
  const t = low(operatorText);
  return (Object.keys(ASK) as Exclude<FactTopic, "other">[]).filter((k) => ASK[k].test(t));
}

export function askedAbout(topic: FactTopic, operatorLines: string[], keywords?: string[]): boolean {
  const res = keywords?.length ? keywords.map((k) => new RegExp(k, "i")) : topic === "other" ? [] : [ASK[topic]];
  return operatorLines.some((line) => res.some((re) => re.test(low(line))));
}

/** Guess the topic of a fact the ticket gives as free text. */
export function topicOfFact(text: string): FactTopic {
  const t = low(text);
  if (/газ/.test(t)) return "gas";
  if (/этаж/.test(t) && /\d/.test(t)) return "floors";
  if (/пострадав|ранен|травм|кричат о помощи|люди на балкон/.test(t)) return "victims";
  if (/без сознан|в сознан|сознани/.test(t)) return "consciousness";
  if (/доступ|заблок|ворота|не открыва|закрыт/.test(t)) return "access";
  if (/угроз|перекидыва|распростран/.test(t)) return "threat";
  if (/пламя|огонь|дым/.test(t)) return "fire";
  if (/\d+\s*(лет|год)/.test(t)) return "age";
  if (/дыш/.test(t)) return "breathing";
  return "other";
}

/** How the card must reflect a fact of this topic once the caller has said it. */
export function expectationOfFact(topic: FactTopic, text: string): FactExpectation | undefined {
  const t = low(text);
  switch (topic) {
    case "gas":
      if (/не газифиц|газа нет|без газа|нет газа/.test(t)) return { kind: "flag", flag: "gas", value: false };
      return { kind: "flag", flag: "gas", value: true };
    case "floors": {
      const n = /(\d+)\s*-?\s*(этаж|эт)/.exec(t) ?? /этажн\w*\s*[-–—:]?\s*(\d+)/.exec(t);
      return n ? { kind: "tag", row: "Этажность здания", value: n[1] } : undefined;
    }
    case "victims":
      if (/пострадавших нет|никто не пострадал|пострадавших не видно|пострадавших не видят|не пострадал/.test(t)) {
        return { kind: "flag", flag: "victims", value: false };
      }
      return { kind: "flag", flag: "victims", value: true };
    case "access":
      if (/доступ есть|открыт/.test(t) && !/не открыва/.test(t)) return undefined;
      return { kind: "flag", flag: "noAccess", value: true };
    case "threat":
      if (/угрозы нет|нет угрозы/.test(t)) return { kind: "flag", flag: "threat", value: false };
      return { kind: "flag", flag: "threat", value: true };
    default:
      return undefined;
  }
}

/** Map the ticket role («мама», «сосед», «работник АЗС») to one of the 6 caller statuses. */
export function statusOfRole(role: string | undefined): CallerStatus | undefined {
  const r = low(role ?? "");
  if (!r) return undefined;
  if ((CALLER_STATUSES as readonly string[]).includes(r)) return r as CallerStatus;
  if (/ребен|ребён|школьн|сын |дочь/.test(r) && !/мама|папа|мать|отец/.test(r)) return "ребёнок";
  if (/мама|папа|мать|отец|муж|жена|супруг|сын|дочь|брат|сестр|бабушк|дедушк|родств|внук|внучк/.test(r)) return "родственник";
  if (/сосед|знаком|друг|подруг|коллег/.test(r)) return "знакомый";
  if (/пострадав|сам себе|себе|вызывает себе/.test(r)) return "пострадавший";
  if (/водител|участник/.test(r)) return "участник";
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
  if (status) cards.push({ key: "status", topic: "status", text: persona.role, label: "статус заявителя", expect: { kind: "status", value: status } });
  if (persona.phone) cards.push({ key: "phone", topic: "phone", text: persona.phone, label: "телефон", expect: { kind: "phone" } });

  if (persona.factCards?.length) {
    // Detailed facts from the scenario editor: a card with a default key («situation», «address»…) replaces it.
    for (const f of persona.factCards) {
      const card = { ...f, label: f.label || TOPIC_LABEL[f.topic] };
      const i = cards.findIndex((c) => c.key === f.key);
      if (i >= 0) cards[i] = { ...cards[i], ...card };
      else cards.push(card);
    }
  } else {
    persona.facts.forEach((text, i) => {
      const topic = topicOfFact(text);
      cards.push({ key: `fact${i + 1}`, topic, text, label: TOPIC_LABEL[topic], expect: expectationOfFact(topic, text) });
    });
  }
  return cards;
}

/** Required questions may come as plain strings from other editors; guess their topic. */
export function normalizeQuestion(q: RequiredQuestion | string): RequiredQuestion {
  const item = typeof q === "string" ? { text: q } : q;
  if (item.topic || item.keywords?.length) return item;
  const t = low(item.text);
  // «Уточнить газификацию» is about gas, not about the address: specific topics win over the verb.
  const order: Exclude<FactTopic, "other">[] = [
    "gas",
    "floors",
    "victims",
    "access",
    "threat",
    "consciousness",
    "breathing",
    "age",
    "fire",
    "name",
    "phone",
    "status",
    "addressExact",
    "address",
    "what",
  ];
  const topic = order.find((k) => ASK[k].test(t)) ?? topicOfFact(item.text);
  return { ...item, topic };
}
