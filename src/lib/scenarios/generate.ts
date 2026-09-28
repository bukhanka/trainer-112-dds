/**
 * Draft scenario from a free-text situation typed by the teacher or an expert
 * («Горит квартира на 5 этаже, в квартире остался ребёнок, ул. Грина, 11»).
 *
 * The model (when configured) only reads the text: caller persona, address, flags, a hint of the incident type.
 * Everything that must be right is computed by rules over the customer's data: the classifier leaf,
 * services by the routing engine, mandatory questions, the reference for ДДС places. Without a model the
 * text is read by keyword rules. The result is always a DRAFT for the teacher to check and approve.
 */
import { z } from "zod";
import type { IncidentType, Prisma } from "@prisma/client";
import { chatJson, llmConfigured } from "../ai/provider";
import { db } from "../db";
import type { CallerPersona, IncidentAddress, IncidentFlags } from "../incident/types";
import { statusOfRole } from "../op112/facts";
import { lookupAddress } from "../routing/address";
import { selectServicesFromDb, type SelectedService } from "../routing/engine";
import { categoryOfType } from "./categories";
import { houseInText, placeOfStreet, streetInText } from "./place";

export type Extracted = {
  title: string;
  caller: CallerPersona;
  address: IncidentAddress;
  flags: IncidentFlags;
  typeHint: string;
  description: string;
  difficulty: number;
};

const extractedSchema = z.object({
  title: z.string().min(3).max(120),
  caller: z.object({
    fullName: z.string().min(3),
    role: z.string().min(2),
    phone: z.string().optional(),
    visibleAddress: z.string().min(3),
    hiddenAddress: z.string().optional().nullable(),
    situation: z.string().min(5),
    facts: z.array(z.string()).default([]),
    temper: z.enum(["calm", "panic", "elderly", "child", "drunk", "angry"]).default("calm"),
    voice: z.enum(["male", "female"]).default("female"),
  }),
  address: z
    .object({ city: z.string().optional(), street: z.string().optional(), house: z.string().optional(), descriptive: z.string().optional() })
    .default({}),
  flags: z
    .object({
      victims: z.boolean().optional(),
      threat: z.boolean().optional(),
      noAccess: z.boolean().optional(),
      gas: z.boolean().optional(),
      offense: z.boolean().optional(),
      med: z.boolean().optional(),
      evac: z.boolean().optional(),
      traffic: z.boolean().optional(),
    })
    .default({}),
  typeHint: z.string().min(2),
  description: z.string().min(5).max(1999),
  difficulty: z.number().int().min(1).max(10).default(4),
});

const EXTRACT_PROMPT = `Ты помогаешь преподавателю учебного центра 112 превратить описание ситуации в учебный вызов.
Верни только JSON:
{
 "title": "коротко, что случилось",
 "caller": {"fullName": "ФИО заявителя (придумай, если нет)", "role": "кто звонит: очевидец, мама, сосед…",
   "phone": "+7 (9xx) xxx-xx-xx", "visibleAddress": "адрес так, как заявитель скажет сначала",
   "hiddenAddress": "точный адрес, если в тексте он уточняется, иначе null",
   "situation": "что заявитель скажет своими словами, от первого лица, 1–2 фразы",
   "facts": ["факты, которые он сообщит только на вопрос: этажность, газ, пострадавшие, доступ…"],
   "temper": "calm|panic|elderly|child|drunk|angry", "voice": "male|female"},
 "address": {"city": "…", "street": "улица без номера дома", "house": "…", "descriptive": "ориентир"},
 "flags": {"victims": bool, "threat": bool, "noAccess": bool, "gas": bool, "offense": bool, "med": bool, "evac": bool, "traffic": bool},
 "typeHint": "тип происшествия как в классификаторе 112, например «пожар: квартира», «запах газа в квартире», «ДТП с пострадавшими», «драка»",
 "description": "описание для карточки: суть, ориентир и пострадавшие — в первых 100 символах",
 "difficulty": 1-10
}
Флаг ставь true только если это прямо следует из текста. Ничего не выдумывай про пострадавших.`;

// ─── rule-based reading (no model) ───────────────────────────────────────────

const FEMALE_NAMES = ["Иванова Анна Сергеевна", "Петрова Ольга Николаевна", "Смирнова Елена Викторовна"];
const MALE_NAMES = ["Кузнецов Игорь Петрович", "Соколов Андрей Ильич", "Волков Дмитрий Олегович"];

const has = (text: string, re: RegExp) => re.test(text.toLowerCase());

function phone(seed: number): string {
  const d = (n: number) => String((seed * 7919 + n * 104729) % 10);
  return `+7 (916) ${d(1)}${d(2)}${d(3)}-${d(4)}${d(5)}-${d(6)}${d(7)}`;
}

export function readByRules(text: string): Extracted {
  const t = text.trim();
  const seed = [...t].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

  const nameMatch = t.match(/([А-ЯЁ][а-яё]+(?:ов|ев|ин|ын|ий|ой|ова|ева|ина|ына|ая|ский|ская))\s+([А-ЯЁ][а-яё]+)(?:\s+([А-ЯЁ][а-яё]+(?:вич|вна|ична|чна)))?/);
  const fullName = nameMatch?.[0] ?? (seed % 2 ? MALE_NAMES[seed % 3] : FEMALE_NAMES[seed % 3]);
  const female = /(а|я|вна|чна)$/.test(fullName.split(" ")[0] ?? "") || /вна$|чна$/.test(fullName);

  const streetMatch = t.match(
    /((?:ул\.?|улица|пр-т|проспект|пер\.?|переулок|ш\.?|шоссе|б-р|бульвар|наб\.?|набережная|пр-д|проезд|пл\.?|площадь)\s+[А-ЯЁ][^,.;\d]*|[А-ЯЁ][а-яё-]+(?:\s[А-ЯЁ]?[а-яё-]+)?\s(?:улица|проспект|переулок|шоссе|бульвар|набережная|проезд))(?:,?\s*(?:д\.?|дом)?\s*(\d+[а-яё]?(?:\/\d+)?))?(?=[,.;\s]|$)/i,
  );
  // «по Ленинскому проспекту», «у дома 3»: forms the pattern above misses are found by the gazetteer.
  const street = streetMatch?.[1]?.trim() ?? streetInText(t) ?? undefined;
  const house = streetMatch?.[2] ?? houseInText(t);

  const flags: IncidentFlags = {};
  // «Плохо» is a person feeling bad («ему плохо», «плохо с сердцем»), not «плохо слышит».
  const unwell = /(^|[^а-яё])(стало|ему|ей|мне|им|человеку|мужчине|женщине|бабушке|дедушке|ребенку|ребёнку|прохожему|соседу|соседке) плохо|плохо с (сердцем|головой)|плохо себя чувству/;
  if (has(t, /пострадав|ранен|травм|без сознания|кров|ожог|задыха|не дышит|разбит[аы]? (голов|лиц|нос)/) || has(t, unwell)) flags.victims = true;
  if (has(t, /угроз|остал(ся|ась|ись)|заперт|кричат|зовут на помощь|дет(и|ей)|ребён|ребен|люди внутри/)) flags.threat = true;
  if (has(t, /(^|[^а-яё])газ(?!ета|он)/)) flags.gas = true;
  if (has(t, /нет доступа|заперт|заблокир|не открыва|заж(ат|ало|али|ата)|не мо(жет|гут) выйти/)) flags.noAccess = true;
  if (has(t, /драк|дерут|дерет|дерёт|напал|угон|краж|избил|избива|угрожа|ограб|хулиган/)) flags.offense = true;
  if (has(t, /скор(ая|ую)|медицин|без сознания|рожает/) || has(t, unwell)) flags.med = true;
  if (has(t, /эвакуац/)) flags.evac = true;
  if (has(t, /перекрыт|перекрыл|пробк|затор/)) flags.traffic = true;

  // Object of the incident, most specific first; the word is how the classifier names it.
  const OBJECTS: [RegExp, string][] = [
    [/мусоропровод/, "мусоропровод"],
    [/мусор|контейнер/, "мусор"],
    [/балкон/, "балкон"],
    [/кухн/, "кухне"],
    [/квартир/, "квартира"],
    [/подъезд|лестничн/, "подъезд"],
    [/подвал/, "подвал"],
    [/лифт/, "лифт"],
    [/крыш|кровл/, "крыша"],
    [/автобус|троллейбус|трамва/, "автобус"],
    [/а\/м|автомоб|машин|иномарк/, "машина"],
    [/трав/, "трава"],
    [/лес/, "лес"],
    [/парк|сквер/, "парк"],
    [/дач/, "дача"],
    [/сара|бытовк/, "сарай"],
    [/частн/, "частный дом"],
    [/ресторан|кафе|магазин|тц|торгов/, "объект"],
  ];
  const object = OBJECTS.find(([re]) => has(t, re))?.[1];
  const fire = has(t, /пожар(?!н)|гор(ит|ят|ел)|пламя|огонь|возгоран/);
  const smoke = has(t, /дым|задымл/);
  let typeHint = t;
  if (has(t, /сигнализац/)) typeHint = "пожарная сигнализация (жилой дом)";
  else if (has(t, /подозрит|тика|бесхоз|взрывн/)) typeHint = "подозрительный предмет";
  else if (has(t, /дтп|авари|столкн|сбил|наезд|врезал/) && !has(t, /залива|затоп|прорыв|лифт/)) {
    const hitPerson = has(t, /(сбил[аио]?|наех[а-я]*)( [а-яё]+)? (женщин|мужчин|человек|пешеход|ребен|ребён|мальчик|девочк|девушк|парн|бабушк|дедушк|старик|школьник|велосипедист)/);
    if (hitPerson || has(t, /лежит|упал|не двигается/)) flags.victims = true;
    typeHint = flags.noAccess
      ? "ДТП с заблокированными"
      : hitPerson
        ? "ДТП наезд на пешехода"
        : `ДТП ${flags.victims ? "с пострадавшими" : "без пострадавших"}${has(t, /бензин|топлив|разли|теч(е|ё)т/) ? " разлитие горючих жидкостей" : ""}`;
  }
  else if (has(t, /залива|затоп|протек|прорыв|прорвал|хлещет|вода (с потолка|льется|льётся)/)) typeHint = "течь прорыв трубы в квартире";
  else if (has(t, /лифт/) && has(t, /застрял|застряли|застрев/)) typeHint = "застревание в лифте";
  else if (fire) typeHint = `пожар: ${object ?? ""}`;
  else if (smoke) typeHint = `задымление: ${object ?? ""}`;
  // «Газ в доме есть» is a gasified house (the flag), not a gas leak: the type needs a smell or a leak of gas.
  else if (flags.gas && has(t, /пахн[её]т газ|запах[а-я]* газ|газом пахн|утечк[а-я]* газ|шипит|газ (идёт|идет|шипит)/))
    typeHint = `запах бытового газа ${object === "кухне" ? "в кухне" : object === "частный дом" ? "в частном доме" : "в многоквартирном доме"}`;
  else if (has(t, /драк|дерут|дерет|дерёт/))
    typeHint = has(t, /((1\d|[2-9]\d)\s*(человек|чел)|десят|толп|массов)/) ? "массовая драка" : has(t, /кварт/) ? "драка в квартире" : "драка на улице";

  // Sentence breaks, but not after address abbreviations like «ул.», «д.», «корп.».
  const sentences = t
    .split(/(?<!(?:^|[\s,(])(?:ул|д|пр|пер|корп|стр|кв|г|пос|мкр|ст|м|им|обл|ш|наб|пл|р-н|пр-т|пр-д|б-р)\.)(?<=[.!?])\s+(?=[А-ЯЁA-Z0-9])/)
    .filter(Boolean);
  const visibleAddress = street ? `${street}${house ? `, ${house}` : ""}` : "не знаю точно, где-то рядом";
  return {
    title: sentences[0].slice(0, 100),
    caller: {
      fullName,
      role: "очевидец",
      phone: phone(seed),
      visibleAddress,
      hiddenAddress: undefined,
      situation: t.length > 240 ? `${t.slice(0, 237)}…` : t,
      facts: sentences.slice(1, 6),
      temper: has(t, /кричат|помогите|срочно|паник/) ? "panic" : "calm",
      voice: female ? "female" : "male",
    },
    address: { city: "Москва", street, house },
    flags,
    typeHint,
    description: t.slice(0, 500),
    difficulty: Math.min(10, 3 + Object.keys(flags).length),
  };
}

const houseKey = (h: string | null | undefined) => (h ?? "").toLowerCase().replace(/\s+/g, "").replace(/^(д|дом|вл)\.?/, "");

/** The model's address against the text: the house it did not read there is dropped, the text's house wins. */
export function saidAddress(text: string, a: Extracted["address"]): Extracted["address"] {
  const rules = readByRules(text).address;
  const digits = a.house?.replace(/\D/g, "");
  const house = rules.house ?? (digits && new RegExp(`(^|\\D)${digits}(\\D|$)`).test(text) ? a.house : undefined);
  return { ...a, street: a.street ?? rules.street, house };
}

// ─── classifier matching ─────────────────────────────────────────────────────

const STOP = new Set([
  "без", "для", "при", "над", "под", "это", "что", "как", "или", "его", "она", "они", "все", "уже", "еще", "там", "тут", "так", "нет", "есть", "мне", "нас", "вас", "где",
  // generic words of leaf names: «(требуется медицинская помощь)», «прочее» — they must not decide the type
  "требуется", "помощь", "прочее", "прочие",
]);
const words = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[^а-яa-z0-9]+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
/** 1 for the same word, 0.8 for a shared 5-letter start, 0.5 for 4 letters: «мусор» beats «мусоропровод». */
function wordMatch(a: string, list: string[]): number {
  let best = 0;
  for (const b of list) {
    if (a === b) return 1;
    const n = a.startsWith(b.slice(0, 5)) && b.length >= 5 && a.length >= 5 ? 0.8 : a.slice(0, 4) === b.slice(0, 4) ? 0.5 : 0;
    if (n > best) best = n;
  }
  return best;
}
/** «без пострадавших» and «с пострадавшими» must not match each other; «без сознания» is no negation. */
const negated = (s: string) => /(^|[^а-яё])без пострадав/i.test(s);

type TypeRow = Pick<IncidentType, "code" | "groupId" | "finalType" | "sign1" | "sign2" | "sign3" | "questions" | "hiddenFromOperator">;

/** How people say it → the classifier's own words: «заливает» is a «течь», «зажало» — «заблокированные». */
const CONCEPTS: [RegExp, string][] = [
  [/залива|залил|затоп|протек|протеч|теч(ь|ет|ёт)|прорвал|прорыв|капает|хлещет|вода (с потолка|льется|льётся)/, "течь прорыв"],
  [/искрит|искрен|замыкан|коротит/, "искрят"],
  [/заж(ат|ало|али|ата)|заблокир|не мо(жет|гут) выйти|не выбраться/, "заблокированными"],
  [/драк|дерут|дерет|дерёт|избива/, "драка"],
  [/застрял|застряли|застрев/, "застревание"],
  [/задыха|не дышит/, "задыхается"],
  [/без сознания|сознани[ея]|не отвечает|не реагирует|обморок/, "сознания"],
  [/(^|[^а-яё])кров(ь|и|ью)([^а-яё]|$)|окровавлен/, "крови"],
  // A person behind a locked door who does not answer for days: the classifier calls it «открыть дверь».
  [/не открыва[а-я]* двер|двер[а-я]* не открыва|не выходит на связь|не отвечает на звонки|не берёт трубку|не берет трубку|давно не видели/, "открыть дверь признаков жизни"],
  [/трупн[а-я]* запах|запах трупа|мертвечин/, "трупный запах"],
  [/(ребен|ребён|малыш|дет[иь]|сын|дочь)[а-яё ]{0,30}(заперт|закрыт|один дома|один в квартире)|(заперт|закрыт)[а-яё ]{0,20}(ребен|ребён|малыш)/, "открыть дверь ребенок закрыт квартире"],
  [/прыгн|спрыгн|покончить с собой|суицид|самоубий|свести счёты|свести счеты/, "суицид приготовление"],
  [/тонет|тонут|утопа|уносит течением|захлёб|захлеб/, "тонет человек"],
];

/** Weak hints: they only break ties between leaves the text already points to («драка» — на улице, не в квартире). */
const WEAK: [RegExp, string][] = [[/во дворе|на улице|у подъезда|на остановке|у магазина|на переходе/, "улице"]];

/** Leaves that need their own word in the text: a railway accident is never guessed from «авария» alone. */
const GATES: [RegExp, RegExp][] = [
  [/(^|[^а-я])жд([^а-я]|$)|ж\/д|железнодорож|электрич|поезд|вагон|рельс|вокзал|платформ|переезд/, /(^|[^а-я])жд([^а-я]|$)|ж\/д|железн|электрич|поезд|вагон|рельс|вокзал|платформ|перрон|переезд/],
  [/метро/, /метро|подземк/],
  [/(^|[^а-я])мцк/, /мцк|кольц/],
  [/аэропорт|воздушн|самол|вертол/, /аэропорт|самол|вертол|воздушн/],
  [/водн[а-я]* транспорт|судн|катер|теплоход|причал|(^|[^а-я])порт([^а-я]|$)/, /судн|катер|теплоход|лодк|причал|(^|[^а-я])порт([^а-я]|$)/],
  [/бпла|беспилот|дрон/, /бпла|беспилот|дрон|коптер/],
  [/(^|[^а-я])лес([^а-я]|у|ной|ном)?([^а-я]|$)/, /(^|[^а-я])лес/],
  // A lift, an explosion or a bomb threat is never guessed either: «остановка» is not a lift stopped between floors.
  [/лифт/, /лифт|кабин/],
  [/взрыв/, /взрыв|взорв|хлоп|бахн|рванул|бомб|заминир/],
  // Gas, a bridge or a height are never guessed either: a smell from a flat is not gas until gas is said.
  [/(^|[^а-я])газ(?!он|ет)/, /(^|[^а-я])газ(?!он|ет)/],
  [/(^|[^а-я])мост/, /(^|[^а-я])мост/],
  [/на высоте/, /высот|подоконник|окн|балкон|карниз/],
];

/** Words that point to a group of the classifier: its leaves get a head start. */
const GROUP_CUES: Record<number, RegExp> = {
  1: /пожар|гор(ит|ят|ел)|пламя|огонь|(^|[^а-я])дым|задымл|гарь/,
  2: /дтп|столкнул|сбил[аи]?|наезд|врезал/,
  13: /(^|[^а-я])газ(?!он|ет)/,
  14: /залива|затоп|течь|теч(ет|ёт)|прорыв|трубу|лифт|искрит|провод|электрощит|канализ|отоплен|батаре|нет света/,
  15: /драк|дерут|избива|напал|угрожа|краж|украл|ограб|угон|хулиган|скандал|шумят/,
  17: /лежит|кричит|крики|тонет|утопа|упал с|суицид|прыгн|(^|[^а-яё])кров(ь|и|ью)([^а-яё]|$)|не открыва[а-я]* двер|не выходит на связь|(заперт|закрыт)[а-яё ]{0,20}(ребен|ребён|малыш)/,
  22: /плохо|боль|болит|сердц|давлени|сознани|обморок|судорог|задыха|рожает|температур|отравил|кровотеч|травм|разбил голову/,
};

/** What the leaf's own words say about people: «нет угрозы» — nobody at risk, «с пострадавшими» — there are victims. */
const NO_RISK = /нет угрозы|без пострадавш|\(без чп\)/i;
const VICTIMS = /с пострадавш|пострадавшие|травм|мед\.? помощ|медицинск|признаков жизни|без сознания|заблокир|тонет|утонул|суицид/i;
const NO_ACCESS = /заблокир|закрыт в|заперт|^открыть дверь/i;
/** The leaf's name and its own signs (sign1 is the subgroup — «Открыть дверь, поднять с пола…» — and says nothing of this leaf). */
const leafText = (row: Pick<TypeRow, "finalType" | "sign2" | "sign3">) => [row.finalType, row.sign2, row.sign3].filter(Boolean).join(" ");

/**
 * Does the leaf contradict the flags read from the text? «Дверь (нет угрозы)» with victims or a need for a doctor
 * does, «ДТП с пострадавшими» with «пострадавших нет» does. Returns the contradictions in words, none — consistent.
 */
export function flagConflicts(row: Pick<TypeRow, "finalType" | "sign2" | "sign3">, flags: IncidentFlags): string[] {
  const text = leafText(row);
  const out: string[] = [];
  if (NO_RISK.test(text)) {
    if (flags.victims) out.push("пострадавшие");
    if (flags.med) out.push("нужна медпомощь");
    if (flags.threat) out.push("угроза людям");
  }
  if (/с пострадавш/i.test(text) && flags.victims === false) out.push("пострадавших нет");
  return out;
}

/**
 * Flags that follow from the leaf itself, on top of what the text said: a medical leaf means a person needs a doctor,
 * «открыть дверь» — no access, «нет угрозы» takes back victims, threat and the doctor. Returns the new flags and what changed.
 */
export function settleFlags(row: Pick<TypeRow, "groupId" | "finalType" | "sign2" | "sign3">, flags: IncidentFlags): { flags: IncidentFlags; changes: string[] } {
  const text = leafText(row);
  const next: IncidentFlags = { ...flags };
  const changes: string[] = [];
  const set = (key: keyof IncidentFlags, value: boolean, label: string) => {
    if (Boolean(next[key]) === value) return;
    next[key] = value as never;
    changes.push(`${value ? "поставлен" : "снят"} признак «${label}»`);
  };
  if (NO_RISK.test(text)) {
    set("victims", false, "пострадавшие");
    set("med", false, "нужна медпомощь");
    set("threat", false, "угроза людям");
  } else {
    if (row.groupId === 22) {
      set("victims", true, "пострадавшие");
      set("med", true, "нужна медпомощь");
    } else if (VICTIMS.test(text)) set("victims", true, "пострадавшие");
    if (NO_ACCESS.test(row.finalType)) set("noAccess", true, "нет доступа");
  }
  return { flags: next, changes };
}

type Ranked = { row: TypeRow; score: number };

/**
 * Classifier leaves ranked for a type hint plus the situation text: token overlap, the hint weighs more,
 * everyday words mapped to the classifier's (CONCEPTS), leaves of the group the text points to first
 * (GROUP_CUES), railway, metro, air, water, lift, gas and bridge leaves only when the text names them (GATES),
 * leaves that contradict the flags read from the text last.
 */
export function rankTypes(types: TypeRow[], typeHint: string, text: string, flags: IncidentFlags = {}): Ranked[] {
  const all = `${typeHint} ${text}`.toLowerCase().replace(/ё/g, "е");
  const hint = [...new Set([...words(typeHint), ...CONCEPTS.filter(([re]) => re.test(all)).flatMap(([, w]) => words(w))])];
  const body = [...(typeHint === text ? [] : words(text)), ...WEAK.filter(([re]) => re.test(all)).flatMap(([, w]) => words(w))];
  const cued = new Set(Object.entries(GROUP_CUES).flatMap(([g, re]) => (re.test(all) ? [Number(g)] : [])));
  const out: Ranked[] = [];
  for (const row of types) {
    if (row.hiddenFromOperator) continue;
    const leaf = `${row.finalType} ${row.sign1 ?? ""} ${row.sign2 ?? ""} ${row.sign3 ?? ""}`.toLowerCase().replace(/ё/g, "е");
    if (GATES.some(([own, need]) => own.test(leaf) && !need.test(all))) continue;
    const final = words(row.finalType);
    const signs = words([row.sign1, row.sign2, row.sign3].filter(Boolean).join(" "));
    let score = cued.has(row.groupId) ? 1.5 : 0;
    for (const w of hint) score += Math.max(3 * wordMatch(w, final), 1.5 * wordMatch(w, signs));
    for (const w of body) score += Math.max(0.25 * wordMatch(w, final), 0.1 * wordMatch(w, signs));
    // Words of the name that the hint does not mention make the leaf more specific than asked.
    score -= 0.4 * final.filter((w) => !hint.some((h) => wordMatch(h, [w]) >= 0.8)).length;
    if (negated(typeHint) !== negated(row.finalType)) score -= 3;
    score -= 3 * flagConflicts(row, flags).length;
    out.push({ row, score });
  }
  return out.sort((a, b) => b.score - a.score || a.row.code - b.row.code);
}

/** Best classifier leaf by the rules, or null when nothing fits. */
export function matchType(types: TypeRow[], typeHint: string, text: string, flags: IncidentFlags = {}): TypeRow | null {
  const best = rankTypes(types, typeHint, text, flags)[0];
  return best && best.score > 0.5 ? best.row : null;
}

/**
 * The short list the model chooses from: the best leaves by the rules, and the two best of every group the text
 * points to, so that the right family is on the list even when its words differ from the text's.
 */
export function typeCandidates(types: TypeRow[], typeHint: string, text: string, flags: IncidentFlags = {}, limit = 8): TypeRow[] {
  const ranked = rankTypes(types, typeHint, text, flags).filter((r) => r.score > 0);
  const out = ranked.slice(0, limit).map((r) => r.row);
  const all = `${typeHint} ${text}`.toLowerCase().replace(/ё/g, "е");
  for (const [g, re] of Object.entries(GROUP_CUES)) {
    if (!re.test(all)) continue;
    for (const r of ranked.filter((x) => x.row.groupId === Number(g)).slice(0, 2)) if (!out.includes(r.row)) out.push(r.row);
  }
  return out.slice(0, limit + 4);
}

const choiceSchema = z.object({ code: z.coerce.number().int(), reason: z.string().min(3).max(400) });

const CHOICE_PROMPT = `Ты старший оператор Системы 112 Москвы. Выбери тип происшествия для учебной карточки строго из списка классификатора.
Смотри на смысл: кто в опасности, что нужно сделать (вскрыть дверь, тушить, спасать из воды, лечить, задержать), а не на отдельные слова.
Тип не должен противоречить признакам: если есть пострадавшие или угроза людям, не выбирай «нет угрозы».
Верни только JSON: {"code": код из списка, "reason": "одна фраза — почему этот тип"}.`;

export type TypeChoice = { row: TypeRow; reason: string; byModel: boolean; candidates: TypeRow[] };

/**
 * The type: the rules pick a short list, the model (if connected) picks one leaf from it with a reason. A code that
 * is not on the list or contradicts the flags is not taken — then the best consistent leaf by the rules is.
 */
export async function chooseType(types: TypeRow[], input: { text: string; typeHint: string; flags: IncidentFlags; remark?: string }): Promise<TypeChoice | null> {
  const text = `${input.text} ${input.remark ?? ""}`.trim();
  const candidates = typeCandidates(types, input.typeHint, text, input.flags);
  const byRules = matchType(types, input.typeHint, text, input.flags);
  if (candidates.length > 1 && llmConfigured()) {
    try {
      const list = candidates.map((c) => `${c.code} — ${c.finalType}${c.sign2 ? ` (${c.sign1}: ${c.sign2})` : ""}`).join("\n");
      const flags = Object.entries(input.flags)
        .filter(([, v]) => v)
        .map(([k]) => k)
        .join(", ");
      const answer = await chatJson(
        [
          { role: "system", content: CHOICE_PROMPT },
          {
            role: "user",
            content: `Ситуация: ${input.text}\n${input.remark ? `Указание преподавателя: ${input.remark}\n` : ""}Признаки из текста: ${flags || "нет"}\nКандидаты:\n${list}`,
          },
        ],
        choiceSchema,
        { temperature: 0, maxTokens: 300 },
      );
      const picked = candidates.find((c) => c.code === answer.code);
      if (picked && !flagConflicts(picked, input.flags).length) return { row: picked, reason: answer.reason.trim().replace(/[.!\s]+$/, ""), byModel: true, candidates };
    } catch {
      // The model is not available or answered off the list — the rules decide.
    }
  }
  return byRules ? { row: byRules, reason: "лучшее совпадение по словам текста и группе", byModel: false, candidates } : null;
}

// Questions the operator asks for every incident of a group, on top of the classifier's own «В:» notes.
const GROUP_QUESTIONS: Record<number, string[]> = {
  1: ["Что горит, есть ли открытое пламя или только дым", "Есть ли люди внутри, угроза людям", "Этажность дома и этаж", "Газифицирован ли дом"],
  2: ["Есть ли пострадавшие, зажатые в машине", "Сколько машин, разлито ли топливо", "Перекрыто ли движение"],
  13: ["Газ магистральный или баллон", "Есть ли пострадавшие", "Не включать свет и не пользоваться огнём, открыть окна"],
  15: ["Сколько участников, есть ли оружие", "Есть ли пострадавшие", "Приметы и куда скрылись"],
  17: ["Возраст и состояние человека: в сознании ли, дышит ли"],
  22: ["Возраст, в сознании ли, дышит ли, что беспокоит"],
};

// ─── reference for ДДС places ────────────────────────────────────────────────

const DDS_RULES = [
  "Открыть карточку — не позже 30 секунд после «Добавлена»; первая запись (статус и текст) — не позже 3 минут после «Добавлена»",
  "«Не принята» и «Отказ от выполнения работ» — только с комментарием: причина и кому передано",
  "«Не принята» можно сменить только на «Принята»; назад по статусам не ходят",
  "«Работы завершены» закрывает карточку: итог пишется в комментарий до сохранения",
  "Служба 103 вместо «Не принята» и «Отказа» ставит «Работы завершены: завершение работ без бригады»",
];

function ddsReferenceFor(services: (SelectedService & { shortName: string })[], finalType: string) {
  const picked = services.filter((s) => s.isMain || /ДДС|Поселение|Упр\./.test(s.shortName)).slice(0, 3);
  return {
    rules: DDS_RULES,
    services: picked.map((s) => ({
      serviceId: s.serviceId,
      service: s.shortName,
      decision: "ACCEPTED",
      chain: s.shortName === "Служба 103" ? ["ACCEPTED", "STARTED", "ARRIVED", "FINISHED"] : ["ACCEPTED", "STARTED", "ARRIVED", "WORKING", "FINISHED"],
      brigadeReport: `Прибыли на место (${finalType}), работы проведены, обстановка нормализована`,
      commentMustHave: ["кто выехал", "что сделано", "итог"],
      traps: ["Не отказываться только потому, что уже реагирует другая служба"],
    })),
  };
}

// ─── main entry ──────────────────────────────────────────────────────────────

export type GenerateResult = { id: string; usedModel: boolean; finalType: string | null; services: number };

/**
 * What the category generator (by-category.ts) already decided by rules: the text is not read again,
 * the classifier leaf and the address are taken as given, the note says where the draft came from.
 */
export type DraftHints = {
  extracted?: Extracted;
  usedModel?: boolean;
  typeCode?: number;
  address?: IncidentAddress;
  category?: string;
  traps?: string[];
  note?: string;
};

export async function generateScenarioDraft(
  input: { text: string; difficulty?: number },
  actor: { id: string },
  hints: DraftHints = {},
): Promise<GenerateResult> {
  const text = input.text.trim().slice(0, 2000);
  let extracted: Extracted;
  let usedModel = false;
  if (hints.extracted) {
    extracted = hints.extracted;
    usedModel = Boolean(hints.usedModel);
  } else if (llmConfigured()) {
    try {
      const parsed = await chatJson(
        [
          { role: "system", content: EXTRACT_PROMPT },
          { role: "user", content: text },
        ],
        extractedSchema,
        { temperature: 0.3, maxTokens: 900 },
      );
      extracted = { ...parsed, caller: { ...parsed.caller, hiddenAddress: parsed.caller.hiddenAddress ?? undefined } };
      extracted.address = saidAddress(text, extracted.address);
      usedModel = true;
    } catch {
      extracted = readByRules(text);
    }
  } else {
    extracted = readByRules(text);
  }
  if (input.difficulty) extracted.difficulty = input.difficulty;

  const types = await db.incidentType.findMany({
    select: { code: true, groupId: true, finalType: true, sign1: true, sign2: true, sign3: true, questions: true, hiddenFromOperator: true },
  });
  const given = hints.typeCode ? types.find((t) => t.code === hints.typeCode) : undefined;
  // The rules pick a short list of classifier leaves, the model (if connected) chooses one with a reason.
  const choice = given ? null : await chooseType(types, { text, typeHint: extracted.typeHint, flags: extracted.flags });
  const type = given ?? choice?.row ?? null;
  // The flags follow the chosen leaf: «открыть дверь» — no access, medicine — a doctor, «нет угрозы» — nobody at risk.
  const settledFlags = type && !given ? settleFlags(type, extracted.flags) : null;
  if (settledFlags) extracted.flags = settledFlags.flags;
  const group = type ? await db.incidentGroup.findUnique({ where: { id: type.groupId } }) : null;

  // The address is exactly what was said. A ticket address counts only for the same house; otherwise the
  // street gives the district (none when the street runs through several) and the house stays as said.
  const said = extracted.address.house;
  const known = extracted.address.street ? lookupAddress(extracted.address.street, said) : null;
  const exact = known && said && houseKey(known.house) === houseKey(said) ? known : null;
  const byStreet = exact || hints.address ? null : placeOfStreet(known?.street ?? extracted.address.street);
  const address: IncidentAddress = hints.address
    ? { country: "Россия", subject: "Москва", city: "Москва", ...hints.address }
    : {
        country: "Россия",
        subject: "Москва",
        city: extracted.address.city ?? "Москва",
        street: known?.street ?? extracted.address.street,
        house: said,
        building: exact?.building ?? undefined,
        structure: exact?.structure ?? undefined,
        district: exact?.district ?? byStreet?.district ?? undefined,
        okrug: exact?.okrug ?? byStreet?.okrug ?? undefined,
        descriptive: extracted.address.descriptive,
      };
  const services = type
    ? await selectServicesFromDb({ typeCodes: [type.code], flags: extracted.flags, district: address.district ?? null, okrug: address.okrug ?? null })
    : [];
  const serviceNames = new Map(
    (await db.service.findMany({ where: { id: { in: services.map((s) => s.serviceId) } }, select: { id: true, shortName: true } })).map((s) => [s.id, s.shortName]),
  );
  const named = services.map((s) => ({ ...s, shortName: serviceNames.get(s.serviceId) ?? String(s.serviceId) }));
  const addressLine = ["Москва", address.street, address.house && `д. ${address.house}`, address.building && `корп. ${address.building}`, address.structure && `стр. ${address.structure}`]
    .filter(Boolean)
    .join(", ");
  const finalType = type?.finalType ?? null;

  const truth: Prisma.InputJsonValue = {
    typeCodes: type ? [type.code] : [],
    acceptableTypeCodes: type ? [type.code] : [],
    finalType,
    tags: type ? [type.sign1, type.sign2, type.sign3].filter(Boolean) : [],
    flags: extracted.flags,
    address,
    addressLine,
    inMoscow: true,
    services: named.map((s) => ({ serviceId: s.serviceId, shortName: s.shortName, isMain: s.isMain, reason: s.reason })),
    requiredQuestions: [
      ...(type?.questions ?? []),
      ...(type ? (GROUP_QUESTIONS[type.groupId] ?? []) : []),
      "Точный адрес: улица, дом, ориентир",
      "ФИО и статус заявителя, контактный телефон",
    ],
    traps: [...(hints.traps ?? []), ...(address.district ? [] : ["Адрес не найден в справочнике — уточнить у заявителя до дома и района"])],
  };
  const ddsCard: Prisma.InputJsonValue = {
    classLabel: finalType,
    tagsLine: type ? [type.sign1, type.sign2, type.sign3].filter(Boolean).join(" · ") : "",
    flags: { victims: !!extracted.flags.victims, refusedAmbulance: false, blocked: !!extracted.flags.noAccess },
    address: addressLine,
    descriptive: address.descriptive ?? null,
    description: extracted.description,
    caller: { fullName: extracted.caller.fullName, status: statusOfRole(extracted.caller.role) ?? "очевидец", aon: extracted.caller.phone, provided: extracted.caller.phone },
    services: named.map((s) => s.shortName),
  };

  const scenario = await db.scenario.create({
    data: {
      title: extracted.title,
      category: hints.category ?? categoryOfType(type) ?? group?.name ?? "прочее",
      difficulty: extracted.difficulty,
      status: "DRAFT",
      source: "generated",
      caller: extracted.caller as unknown as Prisma.InputJsonValue,
      truth,
      ddsCard,
      ddsReference: ddsReferenceFor(named, finalType ?? "происшествие") as unknown as Prisma.InputJsonValue,
      approvedSections: [],
      teacherNote:
        hints.note ??
        [
          `Создан по тексту${usedModel ? " (модель + правила)" : " (правила, без модели)"}: «${text.slice(0, 300)}». Проверьте тип, службы и адрес перед утверждением.`,
          choice &&
            `Тип: «${choice.row.finalType}» (${choice.row.code}) — ${choice.byModel ? `выбран моделью из ${choice.candidates.length} кандидатов классификатора` : "по правилам"}: ${choice.reason}.`,
          settledFlags?.changes.length && `Признаки по типу: ${settledFlags.changes.join(", ")}.`,
        ]
          .filter(Boolean)
          .join("\n"),
      createdById: actor.id,
    },
  });
  return { id: scenario.id, usedModel, finalType, services: named.length };
}

// ─── «Исправь» of the reference card ─────────────────────────────────────────

type Section = Record<string, unknown>;

function lineOf(a: IncidentAddress): string {
  return ["Москва", a.street, a.house && `д. ${a.house}`, a.building && `корп. ${a.building}`, a.structure && `стр. ${a.structure}`].filter(Boolean).join(", ");
}

/**
 * For «Исправь» of the reference card: the model gets a short list of classifier leaves — by its current type, the
 * situation and the remark — and may only choose among them.
 */
export async function truthChoices(scenario: { truth: unknown; ddsCard: unknown; caller?: unknown; title?: string }, remark: string): Promise<string> {
  const types = await db.incidentType.findMany({
    select: { code: true, groupId: true, finalType: true, sign1: true, sign2: true, sign3: true, questions: true, hiddenFromOperator: true },
  });
  const truth = (scenario.truth && typeof scenario.truth === "object" ? scenario.truth : {}) as { finalType?: string; flags?: IncidentFlags };
  const caller = (scenario.caller && typeof scenario.caller === "object" ? scenario.caller : {}) as { situation?: string };
  const card = (scenario.ddsCard && typeof scenario.ddsCard === "object" ? scenario.ddsCard : {}) as { description?: string };
  const situation = [scenario.title, caller.situation, card.description].filter(Boolean).join(" ");
  // Service names are taken out of the remark: «газовая служба» must not bring gas leaves to the list.
  const plain = SERVICE_WORDS.reduce((t, [re]) => t.replace(new RegExp(re.source, "gi"), " "), remark);
  const list = typeCandidates(types, plain, `${situation} ${plain}`, {}, 10);
  if (truth.finalType) {
    const now = types.find((t) => t.finalType === truth.finalType);
    if (now && !list.includes(now)) list.push(now);
  }
  return (
    "Тип происшествия (typeCodes, finalType) выбирай только из этого списка классификатора, код — название:\n" +
    list.map((t) => `${t.code} — ${t.finalType}`).join("\n") +
    "\nПризнаки (flags) не должны противоречить типу. Если преподаватель прямо называет службы, выбери тип, к которому их даёт классификатор; " +
    "список служб в разделе всё равно пересчитают правила по типу, признакам и адресу."
  );
}

/** Services a teacher names in a remark: «нужны 101 и 103», «скорая», «полиция для вскрытия»; «без полиции», «102 не нужна» — drop. */
const SERVICE_WORDS: [RegExp, string][] = [
  [/(^|[^\d])101([^\d]|$)|пожарн|спасател|мчс/i, "Служба 101"],
  [/(^|[^\d])102([^\d]|$)|полици|участков/i, "Служба 102"],
  [/(^|[^\d])103([^\d]|$)|скор(ая|ую|ой)|медпомощ/i, "Служба 103"],
  [/(^|[^\d])104([^\d]|$)|газов(ая|ую|ой) служб|аварийн(ая|ую) газ/i, "Служба 104"],
  [/цэмп/i, "ЦЭМП"],
];
const DROP = /не нужн|не надо|не требуется|лишн|убер|убрать|без (полиции|скорой|пожарных|спасателей|10\d)/i;

export function serviceDemands(remark: string): { need: string[]; drop: string[] } {
  const need = new Set<string>();
  const drop = new Set<string>();
  for (const clause of remark.split(/[.;!?\n,—–]/).filter((c) => c.trim())) {
    const named = SERVICE_WORDS.filter(([re]) => re.test(clause)).map(([, name]) => name);
    for (const n of named) (DROP.test(clause) ? drop : need).add(n);
  }
  for (const n of drop) need.delete(n);
  return { need: [...need], drop: [...drop] };
}

/** Flags the teacher may lack for a service the classifier gives only with a sign: 103 with «пострадавшие» and the like. */
const EXTRA_FLAGS: [keyof IncidentFlags, string][] = [
  ["victims", "пострадавшие"],
  ["med", "нужна медпомощь"],
  ["noAccess", "нет доступа"],
  ["threat", "угроза людям"],
];

/**
 * After the model rewrote the reference 112 card: its incident type must be a real leaf of the classifier that does
 * not contradict the flags; services named in the teacher's remark are brought by the classifier — through the type
 * or a sign the type's routing knows — and only when the classifier cannot, they are added «по указанию
 * преподавателя» with the reason in `notes`. Everything that follows from the type — the services, the card at the
 * ДДС place, the ДДС reference — is rebuilt by the rules. Returns the sections to write, which dependent sections
 * changed (their approval is withdrawn) and notes for the teacher.
 */
export async function settleTruth(
  scenario: { truth: unknown; ddsCard: unknown; ddsReference: unknown; caller?: unknown; title?: string },
  next: Section,
  remark: string,
): Promise<{ truth: Section; ddsCard: Section; ddsReference: Section | null; changed: ("ddsCard" | "ddsReference")[]; notes: string[] }> {
  const types = await db.incidentType.findMany({
    select: { code: true, groupId: true, finalType: true, sign1: true, sign2: true, sign3: true, questions: true, hiddenFromOperator: true },
  });
  const byCode = new Map(types.map((t) => [t.code, t]));
  const real = (v: unknown) => (Array.isArray(v) ? v.map(Number).filter((c) => byCode.has(c)) : []);
  const old = (scenario.truth ?? {}) as { typeCodes?: number[] };
  const notes: string[] = [];

  const flags0 = Object.fromEntries(Object.entries((next.flags as Section) ?? {}).filter(([, v]) => typeof v === "boolean")) as IncidentFlags;
  const given = (next.address && typeof next.address === "object" ? next.address : {}) as IncidentAddress;
  const street = given.district ? null : placeOfStreet(given.street);
  const address: IncidentAddress = { ...given, district: given.district ?? street?.district ?? undefined, okrug: given.okrug ?? street?.okrug ?? undefined };
  const names = new Map((await db.service.findMany({ select: { id: true, shortName: true } })).map((s) => [s.id, s.shortName]));
  const route = async (code: number, flags: IncidentFlags) =>
    (await selectServicesFromDb({ typeCodes: [code], flags, district: address.district ?? null, okrug: address.okrug ?? null })).map((x) => ({
      ...x,
      shortName: names.get(x.serviceId) ?? String(x.serviceId),
    }));

  // Candidates: the model's leaf first, then the rules' short list for its name, the situation and the remark.
  const caller = (scenario.caller && typeof scenario.caller === "object" ? scenario.caller : {}) as { situation?: string };
  const card = (scenario.ddsCard && typeof scenario.ddsCard === "object" ? scenario.ddsCard : {}) as { description?: string };
  const situation = [scenario.title, caller.situation, card.description].filter(Boolean).join(" ");
  const asked = real(next.typeCodes);
  // Without a real code the model's type name and the remark are matched by words; nothing matches — the old type stays.
  const guess = asked.length ? null : matchType(types, String(next.finalType ?? ""), `${String(next.finalType ?? "")} ${remark}`, flags0);
  const first = [...asked, ...(guess ? [guess.code] : []), ...real(old.typeCodes)].map((c) => byCode.get(c)!);
  // Further candidates by the situation and the remark: for a type that contradicts the flags or lacks the named services.
  // The names of services are taken out of the remark first: «газовая служба» must not bring gas leaves to a fight.
  const plain = SERVICE_WORDS.reduce((t, [re]) => t.replace(new RegExp(re.source, "gi"), " "), remark);
  const pool = [...first, ...typeCandidates(types, `${String(next.finalType ?? "")} ${plain}`, `${situation} ${plain}`, flags0, 6)].filter(
    (t, i, all) => all.findIndex((x) => x.code === t.code) === i,
  );
  const consistent = pool.filter((t) => !flagConflicts(t, flags0).length);
  if (first[0] && flagConflicts(first[0], flags0).length) {
    notes.push(`тип «${first[0].finalType}» противоречит признакам (${flagConflicts(first[0], flags0).join(", ")}) — выбран другой`);
  }

  // The teacher's services: brought by the type as is, by the type with one more sign, or by another candidate.
  const demands = serviceDemands(remark);
  // Only named services move the type; a service to drop is never a reason to change it (see the note below).
  const meets = (list: { shortName: string }[]) => demands.need.every((n) => list.some((x) => x.shortName === n));
  let type: TypeRow | null = (first[0] && !flagConflicts(first[0], flags0).length ? first[0] : consistent[0]) ?? first[0] ?? null;
  let flags = type ? settleFlags(type, flags0).flags : flags0;
  let services = type ? await route(type.code, flags) : [];
  if (type && demands.need.length && !meets(services)) {
    let found = false;
    for (const t of consistent) {
      const base = settleFlags(t, flags0).flags;
      const tries: [IncidentFlags, string | null][] = [[base, null], ...EXTRA_FLAGS.filter(([k]) => !base[k]).map(([k, label]): [IncidentFlags, string] => [{ ...base, [k]: true }, label])];
      for (const [f, label] of tries) {
        if (flagConflicts(t, f).length) continue;
        const list = await route(t.code, f);
        if (!meets(list)) continue;
        if (t.code !== type.code) notes.push(`по указанию выбран тип «${t.finalType}»: классификатор даёт к нему ${demands.need.join(", ") || "нужные службы"}`);
        if (label) notes.push(`поставлен признак «${label}» — с ним классификатор даёт ${demands.need.join(", ")}`);
        [type, flags, services, found] = [t, f, list, true];
        break;
      }
      if (found) break;
    }
    if (!found) {
      const missing = demands.need.filter((n) => !services.some((x) => x.shortName === n));
      const ids = new Map([...names].map(([id, name]) => [name, id]));
      for (const n of missing) {
        const id = ids.get(n);
        if (id == null) continue;
        services.push({ serviceId: id, shortName: n, isMain: false, reason: `по указанию преподавателя: классификатор не даёт её к типу «${type.finalType}»`, visible: true });
      }
      if (missing.length) notes.push(`${missing.join(", ")} — классификатор не даёт к типу «${type.finalType}» ни с одним признаком; добавлено по указанию преподавателя`);
    }
  }
  const kept = type ? demands.drop.filter((n) => services.some((x) => x.shortName === n)) : [];
  if (type && kept.length) notes.push(`${kept.join(", ")} классификатор ставит к типу «${type.finalType}» сам — убрать можно, только выбрав другой тип`);
  const codes = type ? [type.code] : [];
  const addressLine = address.street ? lineOf(address) : String(next.addressLine ?? "");
  const finalType = type?.finalType ?? null;
  const tags = type ? [type.sign1, type.sign2, type.sign3].filter(Boolean) : [];

  const truth: Section = {
    ...next,
    typeCodes: codes,
    acceptableTypeCodes: [...new Set([...codes, ...real(next.acceptableTypeCodes)])],
    finalType,
    tags,
    flags,
    address,
    addressLine,
    services: services.map((s) => ({ serviceId: s.serviceId, shortName: s.shortName, isMain: s.isMain, reason: s.reason })),
  };
  const prevCard = (scenario.ddsCard && typeof scenario.ddsCard === "object" ? scenario.ddsCard : {}) as Section;
  const ddsCard: Section = {
    ...prevCard,
    classLabel: finalType,
    tagsLine: tags.join(" · "),
    flags: { victims: !!flags.victims, refusedAmbulance: !!flags.refusedAmbulance, blocked: !!flags.noAccess },
    address: addressLine,
    services: services.map((s) => s.shortName),
  };
  // The ДДС reference names decisions per service: kept only while the type and its services stay.
  const prevRef = (scenario.ddsReference && typeof scenario.ddsReference === "object" ? scenario.ddsReference : null) as { services?: { serviceId?: number }[] } | null;
  const keep = prevRef && codes[0] === old.typeCodes?.[0] && (prevRef.services ?? []).every((s) => services.some((n) => n.serviceId === s.serviceId));
  const ddsReference = keep ? (prevRef as Section) : (ddsReferenceFor(services, finalType ?? "происшествие") as unknown as Section);
  const changed: ("ddsCard" | "ddsReference")[] = [];
  if (JSON.stringify(ddsCard) !== JSON.stringify(prevCard)) changed.push("ddsCard");
  if (!keep) changed.push("ddsReference");
  return { truth, ddsCard, ddsReference, changed, notes };
}
