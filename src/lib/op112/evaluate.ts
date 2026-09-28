/**
 * Review of a 112 operator's card: the card against the scenario's reference answer and — the main
 * part — against what the caller actually said in the conversation («сказал ↔ заполнил»).
 *
 * Rules always run and are deterministic. With a language model configured, two extra checks read
 * the transcript (missed statements, clarity of the description); without a model they stay
 * «не применимо» (ok = null) and do not affect the score.
 */
import { z } from "zod";
import { aiMode, aiOffNote, chatJson, type ChatMessage } from "@/lib/ai/provider";
import { guidanceText, type CorrectionContext, type GuidanceRow } from "@/lib/review/corrections";
import { CALLER_STATUSES, type IncidentAddress, type IncidentCaller, type IncidentFlags } from "@/lib/incident/types";
import { compareStreets as compareKnownStreets } from "@/lib/routing/address";
import type { CriterionResult, WeightGroup } from "@/lib/scoring/score";
import { findKind, kindTitle } from "./catalog";
import { evidenced, factCards, findAsked, keywordRegex, low, normalizeQuestion } from "./facts";
import { addressLine, compareStreets as compareOwnStreets, normHouse } from "./gazetteer";
import type { Persona } from "./caller";
import type { ServiceLite } from "./routing";
import type { CallLine, FactCard, ScenarioTruth, StoredTag } from "./types";
import { linkCheck } from "./links";
import { typingTimeCheck } from "./typing-time";
import { phoneCheck, type PhoneNotice } from "./workoffs";

export type EvalCard = {
  caller: IncidentCaller;
  address: IncidentAddress;
  flags: IncidentFlags;
  tags: StoredTag[];
  cards: string[];
  typeCodes: number[];
  description: string;
  openedAt: Date | null;
  savedAt: Date | null;
  empty?: "noContact" | "dropped";
};

export type EvalInput = {
  card: EvalCard;
  serviceIds: number[];
  persona: Persona | null;
  truth: ScenarioTruth | null;
  /** reference plates: the scenario's list, or what the engine picks for the reference card */
  expectedServices: number[];
  /** set when the plates follow an acceptable alternative leaf the trainee chose instead of the main one */
  expectedServicesBy?: string;
  messages: CallLine[];
  typingSec: number;
  catalog: ServiceLite[];
  /** «Класс.» names for the leaves on the card and in the reference */
  typeNames: Record<number, string>;
  /** flags the chosen panels can set at all (top buttons included); absent — any flag */
  settableFlags?: string[];
  /** calls to the services working by phone and the work-off rows — known once the card is «отработана» */
  phoneNotices?: PhoneNotice[] | null;
  /** the main card this one is linked to («Совпадение»), and the lesson's cards of the incident a repeat call repeats */
  link?: { id: string; number: number } | null;
  repeatCards?: { id: string; number: number; place: string }[];
};

// ─── Reference answer ────────────────────────────────────────────────────────

const ids = z.array(z.number()).catch([]);
const truthSchema = z.object({
  kind: z.string().optional().catch(undefined),
  cards: z.array(z.string()).optional().catch(undefined),
  typeCodes: ids,
  acceptableTypeCodes: ids,
  finalType: z.string().optional().catch(undefined),
  tags: z.array(z.unknown()).catch([]),
  flags: z.record(z.string(), z.boolean()).catch({}),
  address: z.record(z.string(), z.string().nullable()).catch({}),
  services: z.array(z.union([z.number(), z.string(), z.object({ serviceId: z.number() }).passthrough()])).catch([]),
  requiredQuestions: z
    .array(z.union([z.string(), z.object({ text: z.string(), topic: z.string().optional(), keywords: z.array(z.string()).optional() })]))
    .catch([]),
  callerStatus: z.enum(CALLER_STATUSES).optional().catch(undefined),
  descriptionKeywords: z.array(z.string()).optional().catch(undefined),
  traps: z.array(z.string()).catch([]),
  emptyCall: z.enum(["noContact", "dropped"]).optional().catch(undefined),
  repeatOf: z.string().optional().catch(undefined),
});

// What the gist of a kind sounds like in the first 100 characters of the description.
const KIND_GIST: Record<string, string> = {
  "101": "гор|пожар|пламя|дым|задым|возгоран|огон|сигнализац",
  "104": "газ",
  ДТП: "дтп|авари|столкн|наезд|сбил|врезал",
  Взрыв: "взрыв|взорв|хлоп",
};

/**
 * The gist of the incident type in words a dispatcher writes. The final type is read first, then its signs from
 * the most specific one: a category header («Человек в опасности», «Пропал / найден / похищен», «В квартире»,
 * «Вокзал жд платформа жд») says nothing about what happened and must not become the gist.
 */
const TYPE_GIST: [RegExp, string][] = [
  [/газ/, "газ"],
  [/суицид|повесил|вены/, "суицид|повес|вены|таблет|снотворн|покончить|не хочет жить"],
  [/тонет|утон|утопл|в вод|льдин/, "тонет|тонул|утоп|утон|в вод|льдин"],
  [/похищ/, "похит|похищ|затащ|увез"],
  [/пропал|потерял|заблуд|поиск/, "пропал|потерял|ушел|ушёл|не вернул|заблуд|ищ"],
  [/подозрительн[а-я]* гражд|посторонн/, "подозрит|посторонн|незнаком|молод|мужчин|парен|человек"],
  [/дтп.*заблокир|заблокированн/, "заблок|зажат|не может выбраться|застрял"],
  [/открыть дверь|за дверью|закрыт в/, "двер|вскры|открыть|не открыва|закрыт|заперт|заблок"],
  [/ножев/, "нож|ранен|порез"],
  [/огнестрел|стрельб/, "стрел|огнестр|ранен"],
  [/крики о помощи|кричит о помощи/, "крик|крича|кричит|помощ|помогите"],
  [/изнасил/, "изнасил|насил"],
  [/избит|телесн/, "избит|избил|удар|побил|травм|кров|ранен"],
  [/в крови|кровотеч/, "кров|ранен|рана"],
  [/констатац|смерт|труп|скончал|умер/, "смерт|скончал|умер|труп|мертв"],
  [/судорог/, "судорог|припад|эпилеп"],
  [/задыха|тяжело дышать|дыхан/, "задых|дыш|астм|удушь"],
  [/отравлен/, "отрав|таблет|лекарств|препарат|выпил"],
  [/головокруж/, "голов|кружит|сознан|обморок"],
  [/без сознан|обморок/, "сознан|обморок|разбуд|не реагир|не отвечает|не дыш|хрип"],
  [/парализ|инсульт/, "парализ|невнятн|перекош|инсульт|не двига"],
  [/роды|беременн/, "роды|рожает|беремен|воды отошли|схватк"],
  [/угроза обрушения|обрушен/, "обруш|упад|паден|трещин|крепл|рухн|разруш"],
  [/сбит поездом|поездная травма|на рельсы/, "сбил|сбит|поезд|электрич|рельс"],
  [/падени[ея] с высоты/, "упал|падени|сорвал"],
  [/наезд на пешехода/, "пешеход|наезд|сбил"],
  [/скрылась|скрылся/, "скрыл|уехал"],
  [/угон|завладен/, "угон|угнал|угнали|завлад|отобрал"],
  [/драк/, "драк|дерут|дерет|избива"],
  [/хулиган|пьян/, "хулиган|пьян|нетрезв|ругает|пристает|пристаёт|громят|разбил|бит"],
  [/подозрит|предмет/, "предмет|коробк|сумк|пакет|подозрит"],
  [/травм/, "травм|упал|ушиб|перелом|кров|разбил"],
];
/** What burns, in the words people use for it; an object without such a list is not required. */
const FIRE_OBJECT: [RegExp, string][] = [
  [/общественн[а-я]* транспорт|автобус|троллейбус|трамва/, "автобус|троллейбус|трамва|маршрут|транспорт"],
  [/автомашин|автомобил|машина/, "машин|автомоб|а/м|авто|тойот|ваз|иномарк"],
  [/мусоропровод/, "мусоропровод|мусор"],
  [/мусор/, "мусор|контейнер|бак"],
  [/балкон/, "балкон|лоджи"],
  [/трава|пух/, "трав|пух|поле|газон|сух"],
  [/лес|парк|дерев/, "лес|парк|дерев"],
  [/метро/, "метро|станци|платформ|вагон|тоннел"],
  [/вокзал|жд транспорт/, "вокзал|станци|касс|платформ|поезд|электрич"],
];

/** The gist the description must carry beside the kind's own words; undefined when the type gives nothing sure. */
export function gistOf(kind: string | undefined, finalType: string | undefined, tags: unknown[]): string | undefined {
  const signs = tags.filter((t): t is string => typeof t === "string").map((t) => low(t).trim());
  if (kind === "101") {
    const text = low([finalType ?? "", ...signs].join(" "));
    return FIRE_OBJECT.find(([re]) => re.test(text))?.[1];
  }
  for (const text of [low(finalType ?? ""), ...signs.reverse()]) {
    const hit = TYPE_GIST.find(([re]) => re.test(text));
    if (hit) return hit[1];
  }
  return undefined;
}

/** Keywords of the reference card: a fire needs «горит» and what burns; other kinds the gist of the type, else the kind. */
function gistKeywords(kind: string | undefined, finalType: string | undefined, tags: unknown[]): string[] {
  const own = gistOf(kind, finalType, tags);
  const byKind = kind ? KIND_GIST[kind] : undefined;
  const list = kind === "101" ? [byKind, own] : [own ?? byKind];
  return list.filter((k): k is string => Boolean(k));
}

/** Words that tell service 103 there is someone hurt or ill. */
export const VICTIM_WORDS =
  "пострада|сознан|травм|ранен|рана|плохо|ожог|кров|бол|задых|судорог|разбил|ушиб|перелом|отрав|хрип|не дыш|рвот|парализ|сбил|сбит|упал";

/**
 * The first 100 characters go to service 103: they must carry the gist and, when someone is hurt, the victim.
 * A medical call names the victim by its complaint («задыхается», «судороги»), so there the gist is enough.
 * Returns those characters and the keyword sources they miss.
 */
export function firstHundredMisses(
  description: string,
  truth: { descriptionKeywords: string[]; kind?: string },
  victims: boolean,
): { first: string; missing: string[] } {
  const first = description.trim().slice(0, 100);
  const complaintNamesVictim = truth.kind === "103" && truth.descriptionKeywords.length > 0;
  const need = [...truth.descriptionKeywords, ...(victims && !complaintNamesVictim ? [VICTIM_WORDS] : [])];
  return { first, missing: descriptionMisses(first, need) };
}

/**
 * Which leaves the reference plates follow. The system picks the plates from the leaf, so a leaf the reference
 * accepts brings its own plates: judging them by the main leaf would count one choice as two mistakes (and a
 * death reported at night, «Констатация смерти - ночь», would lose to the daytime reference).
 * The main leaf on the card, or no accepted leaf at all, keeps the scenario's own list.
 */
export function referenceLeaves(truth: Pick<ScenarioTruth, "typeCodes" | "acceptableTypeCodes">, cardTypeCodes: number[]): { codes: number[]; alternative: boolean } {
  if (!truth.typeCodes.length || cardTypeCodes.some((c) => truth.typeCodes.includes(c))) return { codes: truth.typeCodes, alternative: false };
  const chosen = cardTypeCodes.filter((c) => truth.acceptableTypeCodes.includes(c));
  return chosen.length ? { codes: chosen, alternative: true } : { codes: truth.typeCodes, alternative: false };
}

/** Scenario.truth from any editor → the shape the checks use; unknown or broken parts become empty. */
export function normalizeTruth(raw: unknown, catalog: ServiceLite[] = []): ScenarioTruth | null {
  if (!raw || typeof raw !== "object") return null;
  const t = truthSchema.parse(raw);
  const kind = t.kind ?? t.cards?.[0];
  const services = t.services
    .map((s) => (typeof s === "number" ? s : typeof s === "string" ? catalog.find((c) => c.shortName === s)?.id : s.serviceId))
    .filter((id): id is number => typeof id === "number");
  const address = Object.fromEntries(Object.entries(t.address).filter(([, v]) => typeof v === "string" && v)) as IncidentAddress;
  const keywords = t.descriptionKeywords?.length
    ? t.descriptionKeywords
    : gistKeywords(kind, t.finalType, t.tags);
  return {
    kind,
    typeCodes: t.typeCodes,
    acceptableTypeCodes: t.acceptableTypeCodes,
    finalType: t.finalType,
    flags: t.flags as IncidentFlags,
    address,
    services,
    requiredQuestions: t.requiredQuestions.map((q) => normalizeQuestion(q as never)),
    callerStatus: t.callerStatus,
    descriptionKeywords: keywords,
    traps: t.traps,
    emptyCall: t.emptyCall,
    repeatOf: t.repeatOf,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const yesNo = (v: boolean | undefined) => (v ? "да" : "нет");
/** A long text cut at a word boundary with «…», never in the middle of a word. */
function cutWords(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,.;:—–-]+$/, "")}…`;
}
const quote = (s: string, max = 140) => `«${cutWords(s, max)}»`;
const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);
const same = (a: string | undefined, b: string | undefined) => low(a ?? "").trim() === low(b ?? "").trim();

const EMPTY_BUTTON = { noContact: "нет контакта", dropped: "срыв звонка" } as const;
const EMPTY_EXPECTED = {
  noContact: "«нет контакта»: контакта с заявителем не было",
  dropped: "«срыв звонка»: звонок сорвался, заявитель ничего не успел сообщить",
} as const;

/** What happened on the line, for the review: silence, a break, what the caller managed to say. */
export function lineStory(messages: CallLine[], facts: FactCard[]): { story: string; said: string[]; cutOff: boolean } {
  const words = messages.filter((m) => m.role === "counterpart" && !m.noise);
  const cutOff = messages.some((m) => m.noise === "hangup");
  const keys = new Set(words.flatMap((m) => m.revealed ?? []));
  // A model does not always mark the address it said: a distinctive word of it in the caller's lines counts too.
  const heard = low(words.map((m) => m.text).join(" "));
  const named = (f: FactCard) =>
    f.expect?.kind === "address" && low(f.text).split(/[^а-яa-z0-9]+/).some((w) => w.length >= 6 && heard.includes(w.slice(0, 5)));
  // «прочее» names nothing: such a line still tells what happened.
  const said = [
    ...new Set(
      facts.filter((f) => keys.has(f.key) || named(f)).map((f) => (f.topic === "other" || f.key === "situation" ? "что случилось" : f.label)),
    ),
  ];
  const story = words.length
    ? `Заявитель сказал: ${quote(words.map((m) => m.text).join(" "), 120)}${cutOff ? ", затем связь прервалась" : ""}`
    : cutOff
      ? "В трубке была тишина, потом короткие гудки"
      : "В трубке была тишина: заявитель не сказал ни слова";
  return { story, said, cutOff };
}

const FLAG_TITLE: Record<string, string> = {
  victims: "Пострадавшие",
  refusedAmbulance: "Нет на месте / Отказ от скорой",
  noAccess: "Нет доступа / Заблокированные",
  threat: "Угроза людям",
  gas: "Проведена ли газификация",
  offense: "Правонарушение",
  med: "Медицинская помощь",
  evac: "Требуется эвакуация",
  traffic: "Перекрытие движения",
  tunnel: "Тоннель",
};

/**
 * A known look-alike street («Дубнинская» for «Дубининская») or the same name of another kind of
 * street is critical: the crew goes to another part of the city. A typo is a plain mistake.
 */
export function streetVerdict(filled: string | undefined, truth: string): "same" | "lookalike" | "typo" | "other" | "empty" {
  if (!filled?.trim()) return "empty";
  const known = compareKnownStreets(filled, truth);
  if (known.verdict === "same") return "same";
  if (known.verdict === "confusable" && known.pair) return "lookalike";
  const own = compareOwnStreets(filled, truth);
  if (own === "same" || own === "lookalike") return own;
  return known.verdict === "confusable" || own === "typo" ? "typo" : "other";
}

function tagMatches(card: EvalCard, row: string, value: string): boolean {
  const options = value.split("|").map((v) => low(v).trim());
  return card.tags.some((t) => {
    if (t.row !== row) return false;
    const v = low(t.text ?? t.value).trim();
    return options.some((o) => v === o || (/^\d+$/.test(o) ? v.replace(/\D/g, "") === o : v.includes(o)));
  });
}

function filledTag(card: EvalCard, row: string): string {
  return card.tags
    .filter((t) => t.row === row)
    .map((t) => t.text ?? t.value)
    .join(", ");
}

/** Stems of the numbers a caller says in words («семнадцатиэтажный», «на седьмом»), to find the line with the value. */
const NUMBER_STEMS: Record<number, string> = {
  1: "одн|перв", 2: "дв[аеу]|втор", 3: "тр[еёи]", 4: "четыр|четв[её]рт", 5: "пят", 6: "шест", 7: "сем|седьм", 8: "вос[еь]м", 9: "девят", 10: "десят",
  11: "одиннадцат", 12: "двенадцат", 13: "тринадцат", 14: "четырнадцат", 15: "пятнадцат", 16: "шестнадцат", 17: "семнадцат", 18: "восемнадцат",
  19: "девятнадцат", 20: "двадцат", 25: "двадцат[ьи]\\s*пят", 30: "тридцат",
};

/** The value of a fact in digits or in words; «семь» does not match «семнадцать». */
function mentionsValue(text: string, value: string): boolean {
  const t = low(text);
  if (!/^\d+$/.test(value)) return t.includes(low(value).slice(0, 6));
  if (new RegExp(`(^|\\D)${value}(\\D|$)`).test(t)) return true;
  const n = Number(value);
  const stem = NUMBER_STEMS[n];
  return Boolean(stem) && new RegExp(`(^|[^а-яё])(?:${stem})${n < 10 ? "(?![а-яё]*надцат)" : ""}`).test(t);
}

/**
 * A number of a panel row written in the description counts only next to the row's word: «дом 17 этажей» is the
 * number of floors, «д. 17» is not. Returns the words that show it, or null.
 */
function tagInDescription(description: string, row: string, value: string): string | null {
  const d = low(description);
  if (!/^\d+$/.test(value)) return descriptionMisses(description, [low(value)]).length === 0 ? value.split("|")[0] : null;
  const stem = (low(row).match(/[а-яё]{4,}/g) ?? []).sort((a, b) => b.length - a.length)[0]?.slice(0, 4);
  if (!stem) return null;
  for (const m of d.matchAll(new RegExp(`(^|\\D)(${value})(?=\\D|$)`, "g"))) {
    const at = (m.index ?? 0) + m[1].length;
    // Widen the window to whole words: the quote starts and ends with a word, «…» where the text goes on.
    let from = Math.max(0, at - 25);
    let to = Math.min(description.length, at + value.length + 25);
    while (from > 0 && /\S/.test(description[from - 1])) from--;
    while (to < description.length && /\S/.test(description[to])) to++;
    const near = description.slice(from, to).trim();
    if (low(near).includes(stem)) return `${from > 0 ? "…" : ""}${near}${to < description.length ? "…" : ""}`;
  }
  return null;
}

function descriptionMisses(description: string, keywords: string[]): string[] {
  const d = low(description);
  return keywords.filter((k) => !(keywordRegex(k)?.test(d) ?? false));
}

/** Flags of the three top buttons: an unpressed button means «нет». */
const TOP = new Set(["victims", "refusedAmbulance", "noAccess"]);

/**
 * Does the card hold this flag value? «Нет» on a panel row must be chosen explicitly: a row nobody
 * answered is not «нет газа», and «Нет данных» is not «нет» either.
 */
function flagHolds(card: EvalCard, flag: keyof IncidentFlags, value: boolean): boolean {
  const filled = card.flags[flag];
  if (value) return filled === true;
  if (TOP.has(flag)) return !filled;
  if (flag === "gas" && card.tags.some((t) => t.row === "Проведена ли газификация" && (t.text ?? t.value) === "Нет данных")) return false;
  return filled === false;
}

function flagText(card: EvalCard, flag: keyof IncidentFlags): string {
  const v = card.flags[flag];
  if (v === true) return "да";
  if (v === false) return "нет";
  return TOP.has(flag) ? "нет" : "не отмечено";
}

// ─── Rule checks ─────────────────────────────────────────────────────────────

export function evaluateOp112Rules(input: EvalInput): CriterionResult[] {
  const { card, truth, persona, messages } = input;
  const out: CriterionResult[] = [];
  const add = (code: string, group: WeightGroup, title: string, ok: boolean | null, extra: Partial<CriterionResult> = {}) =>
    out.push({ code, group, title, ok, source: "rule", ...extra });

  const operatorLines = messages.filter((m) => m.role === "trainee").map((m) => m.text);
  const facts = persona ? factCards(persona) : [];
  const revealed = new Map<string, { fact: FactCard; line: CallLine }>();
  for (const f of facts) {
    // Of the lines that told this fact, the one that has its value: «Дом семнадцатиэтажный», not «на седьмом этаже».
    const lines = messages.filter((m) => m.role === "counterpart" && m.revealed?.includes(f.key));
    const value = f.expect?.kind === "tag" ? f.expect.value.split("|")[0] : null;
    const line = (value ? lines.find((m) => mentionsValue(m.text, value)) : undefined) ?? lines[0];
    if (line) revealed.set(f.key, { fact: f, line });
  }

  // Time to «сохранить» (for an empty card — to «сохранить карточку как пустую»).
  const timeCheck = (done: string) => {
    if (card.openedAt && card.savedAt) out.push(typingTimeCheck(done, (card.savedAt.getTime() - card.openedAt.getTime()) / 1000, input.typingSec));
    else add("op112.typing_time", "timeliness", "Время набора карточки", null);
  };

  // «Нет контакта» / «срыв звонка»: the instruction keeps these buttons for calls that bring nothing
  // («для быстрой обработки нерезультативных вызовов»); a call with words to act on needs a card and services.
  const expectedEmpty = truth?.emptyCall;
  const line = lineStory(messages, facts);
  if (card.empty) {
    if (expectedEmpty) {
      add("op112.empty.button", "completeness", `Нерезультативный вызов закрыт кнопкой «${EMPTY_BUTTON[expectedEmpty]}»`, card.empty === expectedEmpty, {
        evidence: `Нажато «${EMPTY_BUTTON[card.empty]}». ${line.story}`,
        expected: card.empty === expectedEmpty ? undefined : EMPTY_EXPECTED[expectedEmpty],
      });
      if (persona?.line === "silent") {
        add("op112.empty.hail", "completeness", "Прежде чем закрыть вызов, оператор окликнул абонента", operatorLines.length > 0, {
          evidence: operatorLines.length ? `Оператор: ${quote(operatorLines[0])}` : "Кнопка нажата без единой реплики в трубку",
          expected: operatorLines.length ? undefined : "Сказать в трубку, например: «Служба 112, говорите, вас не слышно»",
        });
      }
      timeCheck("Пустая карточка закрыта");
    } else {
      // A caller who was on the line with something to report: an empty card leaves the incident without services.
      add("op112.empty", "completeness", "Карточка не сохранена пустой по ошибке", false, {
        critical: true,
        evidence: `Нажато «${EMPTY_BUTTON[card.empty]}», хотя ${line.said.length ? `заявитель успел сообщить: ${line.said.join(", ")}` : "заявитель был на линии"}${line.cutOff ? " — потом связь прервалась" : ""}`,
        expected: "Вызов результативный: вернуться к заполнению, завести карточку по сказанному и оповестить службы",
      });
    }
    return out;
  }
  if (expectedEmpty) {
    // A card with services for a call that brought nothing sends the services to a call nobody made.
    add("op112.empty.card", "services", "По пустому вызову не заведена карточка со службами", false, {
      critical: true,
      evidence: `Карточка сохранена как обычная${input.serviceIds.length ? ` и ушла в службы (${input.serviceIds.length})` : ""}, хотя ${line.story.charAt(0).toLowerCase()}${line.story.slice(1)}`,
      expected: `${EMPTY_EXPECTED[expectedEmpty]} (Alt+N) → «сохранить карточку как пустую»`,
    });
    return out;
  }
  if (line.cutOff && persona?.line === "drops") {
    add("op112.dropped.card", "completeness", "Сорвавшийся вызов с данными оформлен карточкой, а не пустой", true, {
      evidence: `Связь прервалась, но заявитель успел сообщить: ${line.said.join(", ") || "что случилось"}. Карточка заведена по сказанному${input.serviceIds.length ? ` и ушла в службы (${input.serviceIds.length})` : ""}`,
    });
  }

  timeCheck("Карточка сохранена");

  // Address against the clarified place.
  if (truth && Object.keys(truth.address).length) {
    const t = truth.address;
    const f = card.address;
    const exact = revealed.get("addressExact");
    const said = exact ? `Заявитель уточнил: ${quote(exact.line.text)}` : persona?.hiddenAddress ? `Адрес не уточнён: заявитель назвал только ${quote(persona.visibleAddress)}` : "";
    if (t.street) {
      const verdict = streetVerdict(f.street, t.street);
      add("op112.address.street", "address", "Улица совпадает с местом происшествия", verdict === "same", {
        critical: verdict === "lookalike",
        evidence: [
          verdict === "empty" ? "Улица не заполнена" : `В карточке: ${quote(f.street ?? "")}`,
          verdict === "lookalike" ? "Похожее название, но это другая улица — бригада уедет не туда" : "",
          verdict === "typo" ? "Название улицы записано с ошибкой" : "",
          said,
        ]
          .filter(Boolean)
          .join(". "),
        expected: t.street,
      });
    }
    const houseParts: [keyof IncidentAddress, string][] = [
      ["house", "дом"],
      ["building", "корпус"],
      ["structure", "строение"],
    ];
    const wanted = houseParts.filter(([k]) => t[k]);
    if (wanted.length) {
      const wrong = wanted.filter(([k]) => normHouse(f[k]) !== normHouse(t[k]));
      add("op112.address.house", "address", "Дом, корпус, строение", wrong.length === 0, {
        evidence: wrong.length
          ? `${wrong.map(([k, l]) => `${l}: ${f[k] ? quote(f[k]!) : "пусто"}`).join("; ")}${exact ? `. ${said}` : ""}`
          : `${wanted.map(([k, l]) => `${l} ${f[k]}`).join(", ")}`,
        expected: wanted.map(([k, l]) => `${l} ${t[k]}`).join(", "),
      });
    }
    if (t.district) {
      const ok = same(f.district?.replace(/ё/g, "е"), t.district.replace(/ё/g, "е"));
      add("op112.address.district", "address", "Район определён верно", ok, {
        evidence: f.district ? `В карточке: ${f.okrug ?? ""} ${f.district}`.trim() : "Район не определён — территориальные службы не подтянутся",
        expected: `${t.okrug ?? ""} ${t.district}`.trim(),
      });
    } else if (t.city || t.subject) {
      add("op112.address.region", "address", "Населённый пункт и субъект", same(f.city, t.city) && same(f.subject, t.subject), {
        evidence: `В карточке: ${[f.subject, f.city].filter(Boolean).join(", ") || "пусто"}`,
        expected: [t.subject, t.city].filter(Boolean).join(", "),
      });
    }
    const details: [keyof IncidentAddress, string][] = [
      ["flat", "квартира"],
      ["entrance", "подъезд"],
      ["floor", "этаж"],
      ["code", "код"],
    ];
    const needDetails = details.filter(([k]) => t[k]);
    if (needDetails.length) {
      const wrong = needDetails.filter(([k]) => normHouse(f[k]) !== normHouse(t[k]));
      add("op112.address.details", "address", "Квартира, подъезд, этаж, код", wrong.length === 0, {
        evidence: wrong.length ? `Не так или пусто: ${wrong.map(([k, l]) => `${l} (${f[k] || "пусто"})`).join(", ")}` : "Заполнено",
        expected: needDetails.map(([k, l]) => `${l} ${t[k]}`).join(", "),
      });
    }
  }

  // «Что случилось» and the classification it leads to.
  if (truth?.kind) {
    const expected = findKind(truth.kind)?.name ?? truth.kind;
    const ok = card.cards.some((c) => same(findKind(c)?.name ?? c, expected));
    add("op112.type", "services", "Тип происшествия («что случилось»)", ok, {
      evidence: card.cards.length ? `Выбрано: ${card.cards.map(kindTitle).join(", ")}` : "Тип не выбран",
      expected: kindTitle(expected),
    });
  }
  if (truth?.typeCodes.length) {
    const accepted = new Set([...truth.typeCodes, ...truth.acceptableTypeCodes]);
    const ok = card.typeCodes.some((c) => accepted.has(c));
    const name = (c: number) => input.typeNames[c] ?? String(c);
    add("op112.class", "services", "Классификация по опросной карте («Класс.»)", ok, {
      evidence: card.typeCodes.length ? `В карточке: ${card.typeCodes.map(name).join("; ")}` : "Опросная карта не доведена до вида происшествия",
      expected: truth.finalType ?? truth.typeCodes.map(name).join("; "),
    });
  }

  // Flags of the reference. What the caller said is checked below; a fact the caller never said is
  // the missed question, not a wrong flag; a flag no chosen panel can set is «не применимо».
  const flagFacts = facts.filter((f) => f.expect?.kind === "flag");
  const saidFlags = new Set(
    [...revealed.values()].filter((r) => r.fact.expect?.kind === "flag").map((r) => (r.fact.expect as { flag: string }).flag),
  );
  for (const [key, value] of Object.entries(truth?.flags ?? {})) {
    if (typeof value !== "boolean" || saidFlags.has(key)) continue;
    if (flagFacts.some((f) => (f.expect as { flag: string }).flag === key)) continue;
    const flag = key as keyof IncidentFlags;
    const settable = !input.settableFlags || TOP.has(key) || input.settableFlags.includes(key);
    add(`op112.flag.${key}`, "services", `Флаг «${FLAG_TITLE[key] ?? key}»`, settable ? flagHolds(card, flag, value) : null, {
      evidence: settable ? `В карточке: ${flagText(card, flag)}` : "В выбранной опросной карте такой строки нет",
      expected: yesNo(value),
    });
  }

  // Services against the reference list.
  if (truth) {
    const expected = input.expectedServices;
    const name = (id: number) => input.catalog.find((c) => c.id === id)?.shortName ?? `#${id}`;
    const visible = new Set(input.catalog.map((c) => c.id));
    const shown = expected.filter((id) => visible.has(id));
    const missing = shown.filter((id) => !input.serviceIds.includes(id));
    const extra = input.serviceIds.filter((id) => !expected.includes(id));
    add("op112.services.missing", "services", "Оповещены все нужные службы", shown.length ? missing.length === 0 : null, {
      evidence: missing.length ? `Не хватает: ${missing.map(name).join(", ")}` : "Все нужные службы в карточке",
      expected: `${shown.map(name).join(", ")}${input.expectedServicesBy ? ` (по выбранному допустимому листу «${input.expectedServicesBy}»)` : ""}`,
    });
    add("op112.services.extra", "services", "Нет лишних служб", extra.length === 0, {
      evidence: extra.length ? `Лишние: ${extra.map(name).join(", ")}` : "Лишних нет",
    });
  }

  // Required fields (the instruction lists description, name, caller status and victims). A line that broke
  // before the caller named himself leaves nothing to write: the name and the contact phone are then «не применимо».
  const unsaid = (key: string) => line.cutOff && !revealed.has(key);
  const statusSaid = revealed.get("status");
  const nameFilled = Boolean(card.caller.fullName?.trim());
  add("op112.field.fullName", "completeness", "Заполнена фамилия и имя заявителя", unsaid("name") && !nameFilled ? null : nameFilled, {
    evidence: card.caller.fullName
      ? quote(card.caller.fullName)
      : unsaid("name")
        ? "Связь прервалась раньше, чем заявитель назвался"
        : "Пусто — после сохранения исправить нельзя",
  });
  const statusOk = Boolean(card.caller.status) && (Boolean(statusSaid) || !truth?.callerStatus || card.caller.status === truth.callerStatus);
  add("op112.field.status", "completeness", "Выбран статус заявителя", statusOk, {
    evidence: card.caller.status ? `Выбрано: ${card.caller.status}` : "Статус не выбран",
    expected: !statusSaid && truth?.callerStatus ? truth.callerStatus : undefined,
  });
  const phoneFilled = Boolean(digits(card.caller.provided));
  add("op112.field.phone", "completeness", "Заполнен предоставленный телефон", unsaid("phone") && !phoneFilled ? null : phoneFilled, {
    evidence: card.caller.provided
      ? card.caller.provided
      : unsaid("phone")
        ? "Связь прервалась раньше, чем заявитель назвал номер; АОН в карточке есть"
        : "Пусто: можно было скопировать АОН кнопкой «АОН»",
  });
  add("op112.field.description", "completeness", "Заполнено описание со слов заявителя", card.description.trim().length >= 10, {
    evidence: card.description.trim() ? `${card.description.trim().length} знаков` : "Описание пустое",
  });

  // Required questions, judged by the operator's own lines.
  (truth?.requiredQuestions ?? []).forEach((q, i) => {
    const line = findAsked(q, operatorLines);
    add(`op112.question.${i + 1}`, "completeness", `Задан вопрос: ${q.text}`, Boolean(line), {
      evidence: line ? `Оператор: ${quote(line)}` : "Вопрос не прозвучал",
    });
  });

  // The first 100 characters go to service 103: the gist, and victims if any.
  const victims = Boolean(card.flags.victims || truth?.flags.victims);
  if (truth?.descriptionKeywords.length || victims) {
    const { first, missing: miss } = firstHundredMisses(card.description, { descriptionKeywords: truth?.descriptionKeywords ?? [], kind: truth?.kind }, victims);
    add("op112.description.first100", "literacy", "Суть и пострадавшие — в первых 100 символах описания", first ? miss.length === 0 : false, {
      evidence: first ? `В 103 уйдёт: ${quote(first, 110)}` : "Описание пустое",
      expected: miss.length ? `Добавить в начало: ${miss.map((m) => m.split("|")[0]).join(", ")}` : undefined,
    });
  }

  // «Сказал ↔ заполнил»: every fact the caller said must be in the card.
  for (const { fact, line } of revealed.values()) {
    const e = fact.expect;
    if (!e || e.kind === "address") continue;
    const said = `Заявитель: ${quote(line.text)}`;
    const title = `Сказал ↔ заполнил: ${fact.label}`;
    const code = `op112.said.${fact.key}`;
    if (e.kind === "flag") {
      const settable = !input.settableFlags || TOP.has(e.flag) || input.settableFlags.includes(e.flag);
      // A flag the chosen panel has no row for has to be written in the description instead.
      add(code, "services", title, settable ? flagHolds(card, e.flag, e.value) : evidenced(fact, card.description), {
        evidence: `${said} → в карточке «${FLAG_TITLE[e.flag] ?? e.flag}»: ${flagText(card, e.flag)}`,
        expected: `«${FLAG_TITLE[e.flag] ?? e.flag}»: ${yesNo(e.value)}`,
      });
    } else if (e.kind === "tag") {
      // A panel row, or the value in the description when the panel has no such row. The evidence says which.
      const inPanel = tagMatches(card, e.row, e.value);
      const inText = inPanel ? null : tagInDescription(card.description, e.row, e.value);
      add(code, "services", title, inPanel || Boolean(inText), {
        evidence: `${said} → ${
          inPanel ? `«${e.row}»: ${filledTag(card, e.row)}` : inText ? `в описании: ${quote(inText, 80)}` : `«${e.row}»: ${filledTag(card, e.row) || "не заполнено"}, в описании нет`
        }`,
        expected: `«${e.row}»: ${e.value.split("|")[0]}`,
      });
    } else if (e.kind === "description") {
      const miss = descriptionMisses(card.description, e.keywords);
      add(code, "literacy", title, miss.length === 0, {
        evidence: `${said} → ${miss.length ? "в описании этого нет" : "есть в описании"}`,
        expected: miss.length ? `Записать в описание: ${fact.text}` : undefined,
      });
    } else if (e.kind === "name") {
      const surname = low(persona?.fullName.split(/\s+/)[0] ?? "");
      const ok = Boolean(surname) && low(card.caller.fullName ?? "").includes(surname);
      add("op112.said.name", "completeness", title, ok, {
        evidence: `${said} → в карточке: ${card.caller.fullName ? quote(card.caller.fullName) : "пусто"}`,
        expected: persona?.fullName,
      });
    } else if (e.kind === "phone") {
      const ok = digits(card.caller.provided) === digits(persona?.phone) || digits(card.caller.onSite) === digits(persona?.phone);
      add("op112.said.phone", "completeness", title, ok, {
        evidence: `${said} → предоставленный: ${card.caller.provided || "пусто"}`,
        expected: persona?.phone,
      });
    } else if (e.kind === "status") {
      add("op112.said.status", "completeness", title, card.caller.status === e.value, {
        evidence: `${said} → статус: ${card.caller.status ?? "не выбран"}`,
        expected: e.value,
      });
    }
  }

  // Services that get the card only by phone: called from the work-off row and written down.
  const phone = phoneCheck(phonePlates(input), input.phoneNotices ?? null);
  if (phone) out.push(phone);
  // «Совпадение»: a repeat call is linked to the card of the first call; a new incident is not linked to another.
  const link = linkCheck({ repeatOf: truth?.repeatOf, link: input.link ?? null, repeatCards: input.repeatCards ?? [] });
  if (link) out.push(link);

  return out;
}

/** Plates of the card whose service is told only by phone (Service.delivery = PHONE, a grey plate). */
export function phonePlates(input: Pick<EvalInput, "serviceIds" | "catalog">): { serviceId: number; name: string }[] {
  return input.serviceIds.flatMap((id) => {
    const s = input.catalog.find((c) => c.id === id);
    return s?.delivery === "PHONE" ? [{ serviceId: id, name: s.shortName }] : [];
  });
}

// ─── Model checks ────────────────────────────────────────────────────────────

const aiSchema = z.object({
  discrepancies: z.array(z.object({ field: z.string(), said: z.string(), filled: z.string() })).default([]),
  descriptionClear: z.boolean(),
  descriptionComment: z.string().default(""),
});

export const AI_CODES = ["op112.ai.said", "op112.ai.description"] as const;

export function aiUnavailable(reason: string): CriterionResult[] {
  return [
    { code: "op112.ai.said", group: "completeness", title: "ИИ: всё сказанное заявителем попало в карточку", ok: null, evidence: reason, source: "ai" },
    { code: "op112.ai.description", group: "literacy", title: "ИИ: описание понятно следующему диспетчеру", ok: null, evidence: reason, source: "ai" },
  ];
}

export function aiEnabled(): boolean {
  return aiMode().llm !== "mock";
}

function cardSummary(card: EvalCard): string {
  const flags = Object.entries(card.flags)
    .filter(([, v]) => v)
    .map(([k]) => FLAG_TITLE[k] ?? k);
  return [
    `Заявитель: ${card.caller.fullName || "—"}, статус: ${card.caller.status || "—"}, предоставленный телефон: ${card.caller.provided || "—"}`,
    `Адрес: ${addressLine(card.address) || "—"}; район: ${card.address.district || "—"}; описательный адрес: ${card.address.descriptive || "—"}`,
    `Тип: ${card.cards.map(kindTitle).join(", ") || "—"}`,
    `Опросная карта: ${card.tags.filter((t) => t.rowId !== "_kind").map((t) => `${t.row}: ${t.text ?? t.value}`).join("; ") || "—"}`,
    `Флаги: ${flags.join(", ") || "нет"}`,
    `Описание со слов заявителя: ${card.description || "—"}`,
  ].join("\n");
}

/** Teacher corrections the two model checks are shown (src/lib/review/corrections.ts). */
export type Op112Guidance = { ctx: CorrectionContext; said: GuidanceRow[]; description: GuidanceRow[] };

/** The prompt of the model checks; pure, so it is tested without calling a model. */
export function op112AiMessages(input: EvalInput, guidance?: Op112Guidance, rules: CriterionResult[] = []): ChatMessage[] {
  const transcript = input.messages.map((m) => `${m.role === "trainee" ? "Оператор" : "Заявитель"}: ${m.text}`).join("\n");
  const judged = ruleJudgedTitles(rules);
  const said = guidance ? guidanceText(guidance.ctx, guidance.said) : "";
  const description = guidance ? guidanceText(guidance.ctx, guidance.description) : "";
  return [
    {
      role: "system",
      content: [
        "Ты — наставник, который разбирает работу оператора службы 112 на учебном тренажёре.",
        "Даны расшифровка разговора с заявителем и карточка происшествия, которую оператор заполнил.",
        "1) Найди расхождения «сказал ↔ заполнил»: заявитель ясно сообщил сведение (адрес, пострадавшие, газ, этажность, доступ, угроза, имя, телефон, что произошло), а в карточке его нет или записано иначе. Сведения, которых заявитель не говорил, не считай. Пересказ своими словами — не ошибка.",
        "Поле карточки называется «Фамилия и имя заявителя»: отчество в нём не нужно, фамилия и имя без отчества — не расхождение.",
        "Адрес не оценивай: его сверяют правила с эталонным адресом задания, а заявитель мог оговориться.",
        ...(judged.length ? [`Это уже сверено правилами с эталоном задания — не оценивай и не повторяй: ${judged.map((t) => `«${t}»`).join("; ")}.`] : []),
        "2) Оцени описание со слов заявителя: поймёт ли следующий диспетчер, что случилось, где и есть ли пострадавшие.",
        'Верни JSON: {"discrepancies":[{"field":"поле карточки","said":"точная цитата заявителя","filled":"что в карточке"}],"descriptionClear":true|false,"descriptionComment":"одно предложение"}',
        ...(said ? ["", "К пункту 1 (расхождения «сказал ↔ заполнил»):", said] : []),
        ...(description ? ["", "К пункту 2 (описание):", description] : []),
      ].join("\n"),
    },
    { role: "user", content: `Разговор:\n${transcript || "(пусто)"}\n\nКарточка:\n${cardSummary(input.card)}` },
  ];
}

/** Fields of the card the rules compare with the scenario's reference, and the checks that do it. */
const RULE_FIELDS: { field: RegExp; code: RegExp }[] = [
  {
    field: /адрес|улиц|(^|[^а-я])дом(а|у|е|ом)?(?![а-я])|корпус|строени|владени|квартир|подъезд|этаж(?!н)|домофон|(^|[^а-я])код(?![а-я])|район|округ|город|населен/,
    code: /^op112\.address\./,
  },
  { field: /фио|(^|[^а-я])имя|фамил|заявител/, code: /^op112\.(said\.name|field\.fullName)$/ },
  { field: /телефон/, code: /^op112\.(said\.phone|field\.phone)$/ },
  { field: /статус/, code: /^op112\.(said\.status|field\.status)$/ },
  { field: /(^|[^а-я])тип|класс|что случилось/, code: /^op112\.(type|class)$/ },
  { field: /служб/, code: /^op112\.services\./ },
];

const stems = (s: string) => (low(s).match(/[а-я]{5,}/g) ?? []).map((w) => w.slice(0, 5));

/**
 * Is this field already judged by a rule against the reference? Then the model must not judge it again: the
 * AI caller may slip («корпус 1, 2» for «корпус 1»), and the check by the scenario is the one that counts.
 * A fact the rules compare («Сказал ↔ заполнил: пострадавшие», a flag of the reference) counts by the same stem.
 */
export function judgedByRules(field: string, rules: CriterionResult[]): boolean {
  const f = low(field);
  const applied = rules.filter((c) => c.source === "rule" && c.ok !== null);
  if (RULE_FIELDS.some((t) => t.field.test(f) && applied.some((c) => t.code.test(c.code)))) return true;
  const words = stems(field);
  return applied.some(
    (c) => /^op112\.(said|flag)\./.test(c.code) && stems(c.title.replace(/^Сказал ↔ заполнил:\s*/, "").replace(/^Флаг\s*/, "")).some((w) => words.includes(w)),
  );
}

/** Titles of the rule checks that already compared the card with the reference, for the model to leave alone. */
function ruleJudgedTitles(rules: CriterionResult[]): string[] {
  const judged = rules.filter((c) => c.source === "rule" && c.ok !== null && /^op112\.(address|said|flag|type|class|services|field)\b/.test(c.code));
  return [...new Set(judged.map((c) => c.title))].slice(0, 25);
}

/** «Соколова Вера Ивановна» said, «Соколова Вера» written: the card asks for the surname and the name only. */
export function nameWithoutPatronymic(d: { field: string; said: string; filled: string }): boolean {
  if (!/(фио|имя|фамил|заявител)/i.test(d.field)) return false;
  const words = (s: string) => low(s).replace(/ё/g, "е").split(/[^а-яa-z-]+/).filter((w) => w.length > 1);
  const said = words(d.said);
  const filled = words(d.filled);
  return filled.length >= 2 && filled.every((w) => said.includes(w));
}

/** Transcript vs card by the model. Returns «не применимо» when no model is configured or it fails. */
export async function evaluateOp112Ai(input: EvalInput, guidance?: Op112Guidance): Promise<CriterionResult[]> {
  if (!aiEnabled()) return aiUnavailable(`ИИ-проверка не выполнялась: ${aiOffNote()}`);
  if (input.card.empty) return [];
  try {
    // The rules have already compared the card with the reference; the model looks only at what they cannot see.
    const rules = evaluateOp112Rules(input);
    const res = await chatJson(op112AiMessages(input, guidance, rules), aiSchema, { temperature: 0, maxTokens: 700 });
    const list = res.discrepancies.filter((d) => !nameWithoutPatronymic(d) && !judgedByRules(d.field, rules)).slice(0, 6);
    return [
      {
        code: "op112.ai.said",
        group: "completeness",
        title: "ИИ: всё сказанное заявителем попало в карточку",
        ok: list.length === 0,
        evidence: list.length
          ? list.map((d) => `${d.field}: заявитель ${quote(d.said, 100)} → в карточке ${quote(d.filled || "пусто", 60)}`).join("; ")
          : "Расхождений не найдено",
        source: "ai",
        learned: guidance?.said.map((g) => g.id) ?? [],
      },
      {
        code: "op112.ai.description",
        group: "literacy",
        title: "ИИ: описание понятно следующему диспетчеру",
        ok: res.descriptionClear,
        evidence: res.descriptionComment || undefined,
        source: "ai",
        learned: guidance?.description.map((g) => g.id) ?? [],
      },
    ];
  } catch (err) {
    return aiUnavailable(`ИИ-проверка не удалась: ${err instanceof Error ? err.message.slice(0, 120) : "ошибка"}`);
  }
}
