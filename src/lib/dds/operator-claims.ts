/**
 * The 112 operator on a call from a ДДС place says only what the trainer really does. It corrects the card when the
 * dispatcher names the card and the right information (card-fix.ts). It does not send, re-send or duplicate crews,
 * does not call other services and does not notify them again — nothing of that happens in the system, and the
 * review would read a line like «Пожарных продублировал» as if it had. A model line with such a claim loses that
 * clause and the operator says instead that it will pass it on («передам старшему смены»). A claim that the card
 * was changed is allowed only once the card really was corrected; otherwise the whole line is the rule-based one.
 *
 * The prompt asks for the same (OPERATOR_TRUTH), but a prompt alone does not hold every time: this filter does.
 */

/** Actions of dispatch the system never performs: done or promised. «Передам», «уточню», «исправлю» are allowed. */
const ACTION = new RegExp(
  `(?<![а-яё])(${[
    "про?дублир[а-яё]*",
    "(пере)?направил[аи]?",
    "(пере)?направлен[аоы]?",
    "отправил[аи]?",
    "отправлен[аоы]?",
    "выслал[аи]?",
    "выслан[аоы]?",
    "вызвал[аи]?",
    "вызван[аоы]?",
    "(пере)?оповестил[аи]?",
    "(пере)?оповещ[её]н[аоы]?",
    "уведомил[аи]?",
    "уведомл[её]н[аоы]?",
    "передал[аи]?",
    "передан[аоы]?",
    "сообщил[аи]?",
    "связал(ся|ась|ись)",
    "дозвонил(ся|ась|ись)",
    "поставил[аи]? в известность",
    "подключил[аи]?",
    "добавил[аи]?",
    "выехал[аи]?",
    "выезжа[а-яё]*",
    "едут",
    "в пути",
    "на подходе",
    "направлю",
    "отправлю",
    "вышлю",
    "вызову",
    "(пере)?оповещу",
    "уведомлю",
    "добавлю",
  ].join("|")})(?![а-яё])`,
  "i",
);

/** A claim that the card itself was changed: true only once card-fix.ts has corrected it. */
const CARD_CHANGE =
  /(?<![а-яё])(исправил[аи]?|исправлен[аоы]?|обновил[аи]?|обновл[её]н[аоы]?|внес(ла|ли|ен[аоы]?)?|внёс|внес[её]н[аоы]?|изменил[аи]?|измен[её]н[аоы]?|дополнил[аи]?|дополнен[аоы]?|скорректировал[аи]?|поправил[аи]?|поменял[аи]?|заменил[аи]?)(?![а-яё])|видят изменени|в журнале/i;

/** What the operator says instead of an action the system does not perform. */
export const PASS_ON = "Остальное передам старшему смены.";

/** One more line of the prompt: what the operator may say it has done. */
export const OPERATOR_TRUTH =
  "Ты только принимаешь информацию и исправляешь карточку по сообщённой ошибке. Службы и бригады ты не направляешь, не дублируешь, не вызываешь и повторно не оповещаешь: на такую просьбу скажи «передам старшему смены» или «уточню».";

/** The line claims an action of dispatch (done or promised) that the trainer does not perform. */
export function claimsAction(text: string): boolean {
  return ACTION.test(text);
}

/** The line claims a change in the card. */
export function claimsCardEdit(text: string): boolean {
  return CARD_CHANGE.test(text);
}

/**
 * The model's line as the operator may say it: clauses claiming an action go and «передам старшему смены» takes
 * their place; before the card is corrected, a claim of a change in the card makes the whole line the rule-based one.
 */
export function settleOperatorLine(text: string, cardCorrected: boolean, fallback: string): string {
  const sentences = text.match(/[^.!?…]+[.!?…]*\s*/g) ?? [];
  if (!cardCorrected && sentences.some(claimsCardEdit)) return withPassOn(fallback, sentences.some(claimsAction));
  if (!sentences.some(claimsAction)) return text;
  // A claim goes by its clause: «Принято, данные обновил, службы переоповестил.» → «Принято, данные обновил.», and
  // «передам старшему смены» comes right after it.
  const out: string[] = [];
  let passed = false;
  for (const sentence of sentences) {
    if (!claimsAction(sentence)) {
      out.push(sentence.trim());
      continue;
    }
    const end = /[.!?…]+\s*$/.exec(sentence)?.[0].trim() || ".";
    const clauses = sentence.replace(/[.!?…]+\s*$/, "").split(/,\s*|;\s*|\s+и\s+(?=[а-яё]+(?:л|ла|ли|ен[аоы]?|ано|ены)(?![а-яё]))/i);
    const kept = clauses.filter((c) => c.trim() && !claimsAction(c));
    if (kept.length) out.push(`${kept.join(", ").trim()}${end}`);
    if (!passed) out.push(PASS_ON);
    passed = true;
  }
  const said = out.filter((s) => s !== PASS_ON).join(" ").trim();
  return said ? out.join(" ").trim() : withPassOn(fallback, true);
}

function withPassOn(line: string, dropped: boolean): string {
  if (!dropped || /передам|уточню/i.test(line)) return line;
  return `${line.trim().replace(/([^.!?…])$/, "$1.")} ${PASS_ON}`;
}
