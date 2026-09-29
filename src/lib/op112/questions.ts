/**
 * Clarifying the place, judged by the order of the call. A reference question «Уточнить адрес: первый ответ заявителя
 * неполный или неточный» is a question asked after the caller's first answer about the place, not the first «Назовите
 * адрес»: a line said before the caller answered cannot clarify that answer. Other required questions are matched by
 * their words (facts.ts, findAsked).
 */
import { spokenMatchesFact } from "./caller";
import { askedTopics, low } from "./facts";
import type { CallLine, FactCard, RequiredQuestion } from "./types";

/** «Уточнить адрес…», «Уточнить улицу, а не станцию метро», «Уточнить, где именно в лесопарке»; not the region. */
export function isPlaceClarification(q: Pick<RequiredQuestion, "text">): boolean {
  const t = low(q.text).trim();
  if (!/^уточн/.test(t)) return false;
  return /адрес|улиц|(^|[^а-я])дом|строени|корпус|где именно|мест|вход|ориентир|станци/.test(t);
}

/** An operator line about the place: the address, the house, where exactly, a landmark, which entrance. */
export function asksPlace(text: string): boolean {
  const topics = askedTopics(text);
  return topics.includes("address") || topics.includes("addressExact") || /(^|[^а-я])где(?![а-я])|точнее|какой вход|с какой стороны/.test(low(text));
}

export type ClarificationVerdict = { ok: boolean | null; evidence: string; expected?: string };

const quote = (s: string, max = 110) => `«${s.length > max ? `${s.slice(0, max - 1).replace(/\s+\S*$/, "").replace(/[\s,.;:!?—–-]+$/, "")}…` : s}»`;
const spoken = (m: CallLine) => m.role === "counterpart" && !m.noise;

/**
 * The clarification of the place: an operator line about the place after the caller's first answer about it — the
 * reply to the first question about the address, or the first line where the caller named the place by himself.
 * When that first answer already was the exact place there was nothing to clarify: «не применимо».
 */
export function judgeClarification(messages: CallLine[], facts: FactCard[]): ClarificationVerdict {
  const visible = facts.find((f) => f.key === "address");
  const exact = facts.find((f) => f.key === "addressExact");
  const named = (m: CallLine) =>
    spoken(m) &&
    (Boolean(m.revealed?.some((k) => k === "address" || k === "addressExact")) ||
      Boolean(visible && spokenMatchesFact(visible, m.text)) ||
      Boolean(exact && spokenMatchesFact(exact, m.text)));
  const firstAsk = messages.findIndex((m) => m.role === "trainee" && asksPlace(m.text));
  const reply = firstAsk >= 0 ? messages.findIndex((m, i) => i > firstAsk && spoken(m)) : -1;
  const selfNamed = messages.findIndex(named);
  const first = [reply, selfNamed].filter((i) => i >= 0).sort((a, b) => a - b)[0] ?? -1;
  const expected = "После первого ответа заявителя об адресе переспросить: номер дома, корпус, «где именно», ориентир";
  if (first < 0) {
    return {
      ok: false,
      evidence: firstAsk >= 0 ? `Оператор: ${quote(messages[firstAsk].text)} — заявитель адрес так и не назвал` : "Вопросов об адресе не было",
      expected,
    };
  }
  const answer = messages[first];
  const after = messages.slice(first + 1).filter((m) => m.role === "trainee" && asksPlace(m.text));
  // The line that asks most precisely is quoted: «Какой номер дома?» rather than «Адрес?».
  const clarifying = after.find((m) => askedTopics(m.text).includes("addressExact")) ?? after[0];
  if (clarifying) return { ok: true, evidence: `Оператор: ${quote(clarifying.text)} — после ответа заявителя ${quote(answer.text, 90)}` };
  if (!exact || spokenMatchesFact(exact, answer.text)) {
    const asked = firstAsk >= 0 && firstAsk < first ? `на вопрос ${quote(messages[firstAsk].text, 80)} ` : "";
    return { ok: null, evidence: `Уточнять не пришлось: ${asked}заявитель сразу назвал точный адрес: ${quote(answer.text, 90)}` };
  }
  const early = firstAsk >= 0 && firstAsk < first ? `. Вопрос ${quote(messages[firstAsk].text, 80)} прозвучал до ответа — это ещё не уточнение` : "";
  return { ok: false, evidence: `Заявитель назвал место неполно: ${quote(answer.text, 100)}; уточняющего вопроса после этого не было${early}`, expected };
}
