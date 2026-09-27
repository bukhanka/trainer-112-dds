/**
 * «Понятно следующему диспетчеру без звонка»: clarity of a ДДС dispatcher's comments by rules.
 *
 * The next dispatcher reads only the comments of the plate: the answer to a refusal («Не принята»,
 * «Отказ» — why and to whom it was passed) and the final one. The rules catch what makes such a comment
 * unreadable without a phone call, deterministically — the same text always gets the same verdict:
 *
 *   short        — one word or a few letters: «ок», «отпр бр», «Сделано»;
 *   noResult     — the closing comment does not say how it ended: «бригада на месте, работают»,
 *                  or only repeats the status: «Работы завершены»;
 *   abbreviation — a private abbreviation or truncation: «АБ», «бриг.», «п/б». Official ones (ДДС, МЧС,
 *                  ЦЭМП, ГБУ, округа…) and the words on the service plates are fine;
 *   layout       — a word typed in the English layout: «ghbyznf» instead of «принята».
 *
 * Typos are not counted: a comment with a typo is still understood. What rules cannot judge (vague
 * wording, an unclear «туда», facts in a muddled order) is left to the model check (clarity-ai.ts).
 */
import type { ServiceStatus } from "@prisma/client";

export type JudgedComment = {
  status: ServiceStatus;
  text: string;
  /** The comment that closes the service's work on the card («Работы завершены», «Отказ», the last «Не принята»). */
  final: boolean;
};

export type ClarityIssue = {
  kind: "short" | "noResult" | "abbreviation" | "layout";
  status: ServiceStatus;
  /** The words that cause the problem, quoted in the evidence. */
  fragment: string;
  /** How to write it instead. */
  hint: string;
};

/** Official abbreviations every dispatcher of the city knows: services, organisations, okrugs, documents. */
export const OFFICIAL_ABBREVIATIONS: ReadonlySet<string> = new Set([
  // dispatch and rescue
  "ДДС", "ЕДДС", "ЕДС", "ОДС", "АДС", "ЦУКС", "МЧС", "ГПС", "ПЧ", "ПСЧ", "СПСЧ", "ПСО", "ПСС", "АСС", "АСФ", "АСО", "ГИМС",
  "АЦ", "АЛ", "АКП", "ГО", "ЧС", "КЧС", "ЭРА", "ГЛОНАСС", "АРМ", "АОН", "ВИС", "КП", "КУСП",
  // medicine
  "ЦЭМП", "СМП", "НМП", "ГБУЗ", "ГКБ", "ДГКБ", "ГП", "ДГП", "ПНД", "НИИ", "ЛПУ",
  // police and supervision
  "МВД", "ГУ", "УВД", "УМВД", "ОМВД", "ОВД", "ОП", "ППС", "ППСП", "ДПС", "ГИБДД", "ОГИБДД", "ГАИ", "СК", "ФСБ", "ОВО", "ЧОП", "ПДН", "ОАТИ",
  // city economy and organisations
  "ЦОДД", "ГБУ", "ГКУ", "ГУП", "МУП", "ФГУП", "АО", "ОАО", "ПАО", "ЗАО", "ООО", "ИП", "НКО", "ТСЖ", "ЖСК", "УК", "ЖКХ", "ЖКУ", "ДЖКХ",
  "ЕИРЦ", "МФЦ", "ДЕЗ", "РЭУ", "ЖЭУ", "ЖЭК", "ИТП", "ЦТП", "КНС", "ВНС", "ВЗУ", "ГРП", "ШРП", "ЛЭП", "ТП", "РП", "КТП", "РЭС", "ТЭЦ",
  "МОЭК", "МОЭСК", "ОЭК", "МКД", "ТЦ", "ТРЦ", "БЦ", "ДК", "АЗС", "АГЗС", "КПП", "СНТ", "ДНТ", "ГСК", "АПС", "РЖД", "МЖД", "ЦППК",
  // roads and territories
  "МКАД", "ТТК", "ЦКАД", "МЦК", "МЦД", "ДТП", "ТС", "РФ", "ФИО",
  "ЦАО", "САО", "СВАО", "ВАО", "ЮВАО", "ЮАО", "ЮЗАО", "СЗАО", "НАО", "ТАО",
]);

/** Standard shortenings with a dot or without vowels: addresses, units, «гр.», «зам.», «нач.». */
const STANDARD_SHORT: ReadonlySet<string> = new Set([
  "ул", "кв", "корп", "стр", "пос", "пгт", "дер", "пр", "просп", "наб", "пер", "пл", "эт", "под", "мин", "сек", "тел", "им", "др", "см",
  "руб", "тыс", "млн", "кг", "км", "мм", "мл", "чел", "ст", "вл", "влд", "мкр", "мкрн", "обл", "тер", "соор", "лит", "оф", "пом",
  "гр", "зам", "нач", "деж", "отд", "зд", "шт", "тт", "пр-т", "р-н",
]);

const SLASH_OK: ReadonlySet<string> = new Set(["а/м", "т/с", "ж/д", "б/у", "н/д"]);
const LATIN_OK: ReadonlySet<string> = new Set(["gps", "sms", "mms", "sim", "vin", "wifi", "www", "http", "https", "ru", "com", "email"]);

/** Typical private shortenings of the job and what to write instead. */
const EXPAND: Record<string, string> = {
  аб: "аварийная бригада",
  бр: "бригада",
  бриг: "бригада",
  авар: "аварийная",
  напр: "направлена",
  отпр: "отправлена",
  прибл: "прибыла",
  эвак: "эвакуированы",
  госп: "госпитализирован",
  пострад: "пострадавший",
  сотр: "сотрудник",
  уч: "участковый",
  "п/б": "пожарная бригада",
};

const EN = "qwertyuiop[]asdfghjkl;'zxcvbnm,.`";
const RU = "йцукенгшщзхъфывапролджэячсмитьбюё";

/** «ghbyznf» → «принята»: what the word would have been in the Russian layout. */
export function fromEnglishLayout(word: string): string {
  return [...word.toLowerCase()].map((ch) => RU[EN.indexOf(ch)] ?? ch).join("");
}

const LETTER = /[a-zа-яё]/i;
const CYR_WORD = /[а-яё]+/gi;
const VOWEL = /[аеёиоуыэюя]/i;

/** Status echoed instead of a result: «Работы завершены», «Выполнено», «Сделано». */
const STATUS_ECHO = /^(работы?\s+)?(завершены|завершено|выполнены|выполнено|окончены|закончены|сделано|готово|отработано|закрыто|ок|ok|всё|все)[.!\s]*$/i;

/** Words that say how it ended: a done action, a state, «нет» of a danger, «к сведению». */
const RESULT_STEM =
  /(устран|ликвид|потуш|локализ|перекры|отключ|обесточ|восстанов|подан|подал|подключ|запущ|запуст|замен|отремонт|исправ|провед|выполн|заверш|законч|эвакуир|госпитал|достав|переда|сообщ|проинформ|уведомл|оповещ|вызва|направл|прибы|осмотр|обследов|провер|очищ|убра|вывез|огорож|огражд|оцепл|спас|задерж|оформл|составл|опрош|вскры|открыт|закрыт|снят|откач|засыпа|распил|спил|закрепл|стабил|оказан|отказ|отмен|штатн|функционир|сведени|норм|ложн)/i;
const RESULT_FORM = /[а-яё]{3,}(?:ла|ло|ли|лся|лась|лось|лись|ена|ено|ены|ёна|ёно|ёны|ен|ён|ана|ано|аны|ята|ято|яты|ыт|ыта|ыто|ыты|ута|уто|уты)(?![а-яё])/i;
const NO_DANGER = /(?<![а-яё])(нет|не\s+(выявл|обнаруж|подтвер|требу|потребова|проводил))/i;

export function statesResult(text: string): boolean {
  if (STATUS_ECHO.test(text.trim())) return false;
  return RESULT_STEM.test(text) || RESULT_FORM.test(text) || NO_DANGER.test(text);
}

/** Upper-case abbreviations in the service names (they are on the plates, so everyone knows them). */
export function abbreviationsIn(names: string[]): string[] {
  const out = new Set<string>();
  for (const name of names) {
    for (const w of name.match(CYR_WORD) ?? []) if (w.length >= 2 && w.length <= 6 && w === w.toUpperCase()) out.add(w);
    // «Деп.», «Упр.», «Мос.Без.»: shortenings printed on the plates.
    for (const m of name.matchAll(/([а-яё]{2,6})\./gi)) out.add(m[1].toLowerCase());
  }
  return [...out];
}

const cut = (s: string, max = 60) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** Problems of one comment. `known` are extra official words (from the service plates), upper case or a shortening. */
export function commentIssues(c: JudgedComment, known: ReadonlySet<string> = new Set(), opts: { fixedPhrase?: boolean } = {}): ClarityIssue[] {
  const text = c.text.trim();
  const out: ClarityIssue[] = [];
  const add = (kind: ClarityIssue["kind"], fragment: string, hint: string) => out.push({ kind, status: c.status, fragment, hint });

  const tokens = text.match(/[a-zа-яё0-9]+/gi) ?? [];
  const letters = [...text].filter((ch) => LETTER.test(ch)).length;
  if (!text) {
    add("short", "", "Комментария нет — напишите полным предложением, что сделано и чем закончилось");
    return out;
  }
  if (tokens.length < 2 || letters < 10) {
    add("short", cut(text), "Одного-двух слов мало: полным предложением — что сделано, чем закончилось, кому передано");
  } else if (c.final && (c.status === "FINISHED" || c.status === "REFUSED") && !opts.fixedPhrase && !statesResult(text)) {
    add(
      "noResult",
      cut(text),
      STATUS_ECHO.test(text)
        ? "Статус повторять не нужно: напишите итог — что сделано и в каком состоянии объект"
        : "Не сказано, чем закончилось: итог работ («течь устранена, вода подана») или почему работы не проводились",
    );
  }

  // Upper-case words are abbreviations unless the whole comment is typed in capitals.
  const words = text.match(CYR_WORD) ?? [];
  const upper = [...text].filter((ch) => /[А-ЯЁ]/.test(ch)).length;
  const shouting = words.length >= 3 && upper >= letters * 0.6;
  const seen = new Set<string>();
  const flag = (word: string, hint: string) => {
    const key = word.toLowerCase().replace(/\.$/, ""); // «бр.» and «бр» are one problem
    if (seen.has(key)) return;
    seen.add(key);
    add("abbreviation", word, hint);
  };
  const spell = (word: string) => {
    const full = EXPAND[word.toLowerCase().replace(/\.$/, "")];
    return full ? `Писать полностью: «${full}»` : "Писать полностью: сокращение знает не каждый диспетчер";
  };
  if (!shouting) {
    for (const w of words) {
      if (w.length < 2 || w.length > 6 || w !== w.toUpperCase()) continue;
      if (OFFICIAL_ABBREVIATIONS.has(w) || known.has(w)) continue;
      flag(w, spell(w));
    }
  }
  // «бриг. выехала», «устр. в 14:30»: a cut word with a dot and the sentence going on.
  for (const m of text.matchAll(/(?<![а-яё])([а-яё]{2,6})\.(?=\s*[а-яё0-9])/gi)) {
    const w = m[1].toLowerCase();
    if (STANDARD_SHORT.has(w) || known.has(w)) continue;
    flag(`${m[1]}.`, spell(w));
  }
  // «бр», «нпр»: lower-case letters without a single vowel are not a word.
  for (const w of words) {
    if (w.length < 2 || w !== w.toLowerCase() || VOWEL.test(w)) continue;
    if (STANDARD_SHORT.has(w) || known.has(w)) continue;
    flag(w, spell(w));
  }
  // «п/б», «о/п»: slash shortenings other than the usual а/м, т/с, ж/д.
  for (const m of text.matchAll(/(?<![а-яё])([а-яё]{1,2}\/[а-яё]{1,2})(?![а-яё])/gi)) {
    const w = m[1].toLowerCase();
    if (!SLASH_OK.has(w)) flag(m[1], spell(w));
  }

  for (const w of text.match(/[a-z]{3,}/gi) ?? []) {
    if (LATIN_OK.has(w.toLowerCase())) continue;
    add("layout", w, `Набрано в английской раскладке — по-русски это «${fromEnglishLayout(w)}». Переключите раскладку (Alt+Shift) и перепечатайте`);
  }
  return out;
}

/**
 * Comments the next dispatcher reads: every «Не принята» and «Отказ» (why and to whom it was passed) and
 * the one that ends the work — the closing status, or the last «Не принята» when the plate ended there.
 */
export function judgedComments(own: { status: ServiceStatus; comment: string | null }[]): JudgedComment[] {
  const closingAt = own.findIndex((e) => e.status === "FINISHED" || e.status === "REFUSED");
  const answers = own.filter((e) => e.status === "ACCEPTED" || e.status === "REJECTED");
  const lastAnswer = answers[answers.length - 1];
  const out: JudgedComment[] = [];
  own.forEach((e, i) => {
    const closing = i === closingAt;
    const endsOnRefusal = closingAt < 0 && e === lastAnswer && e.status === "REJECTED";
    if (!closing && e.status !== "REJECTED") return;
    out.push({ status: e.status, text: (e.comment ?? "").trim(), final: closing || endsOnRefusal });
  });
  return out;
}

export function clarityIssues(comments: JudgedComment[], known: ReadonlySet<string> = new Set(), fixedPhrase?: string): ClarityIssue[] {
  const fixed = fixedPhrase?.toLowerCase();
  return comments.flatMap((c) => commentIssues(c, known, { fixedPhrase: Boolean(fixed && c.text.toLowerCase().includes(fixed)) }));
}
