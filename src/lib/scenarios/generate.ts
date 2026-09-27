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
import { placeOfStreet } from "./place";

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
  const street = streetMatch?.[1]?.trim();
  const house = streetMatch?.[2];

  const flags: IncidentFlags = {};
  if (has(t, /пострадав|ранен|травм|без сознания|кров|ожог|задыха|не дышит|плохо|разбит[аы]? (голов|лиц|нос)/)) flags.victims = true;
  if (has(t, /угроз|остал(ся|ась|ись)|заперт|кричат|зовут на помощь|дет(и|ей)|ребён|ребен|люди внутри/)) flags.threat = true;
  if (has(t, /газ(?!ета)/)) flags.gas = true;
  if (has(t, /нет доступа|заперт|заблокир|не открыва/)) flags.noAccess = true;
  if (has(t, /драк|дерут|дерет|дерёт|напал|угон|краж|избил|избива|угрожа|ограб|хулиган/)) flags.offense = true;
  if (has(t, /скор(ая|ую)|медицин|без сознания|плохо|рожает/)) flags.med = true;
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
  else if (has(t, /дтп|авари|столкн|сбил|наезд|врезал/))
    typeHint = `ДТП ${flags.victims ? "с пострадавшими" : "без пострадавших"}${has(t, /бензин|топлив|разли|теч(е|ё)т/) ? " разлитие горючих жидкостей" : ""}`;
  else if (fire) typeHint = `пожар: ${object ?? ""}`;
  else if (smoke) typeHint = `задымление: ${object ?? ""}`;
  else if (flags.gas) typeHint = `запах бытового газа ${object === "кухне" ? "в кухне" : object === "частный дом" ? "в частном доме" : "в многоквартирном доме"}`;
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

// ─── classifier matching ─────────────────────────────────────────────────────

const STOP = new Set(["без", "для", "при", "над", "под", "это", "что", "как", "или", "его", "она", "они", "все", "уже", "еще", "там", "тут", "так", "нет", "есть", "мне", "нас", "вас", "где"]);
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
/** «без пострадавших» and «с пострадавшими» must not match each other. */
const negated = (s: string) => /(^|[^а-яё])без([^а-яё]|$)/i.test(s);

type TypeRow = Pick<IncidentType, "code" | "groupId" | "finalType" | "sign1" | "sign2" | "sign3" | "questions" | "hiddenFromOperator">;

/** Best classifier leaf for a type hint plus the situation text: token overlap, the hint weighs more. */
export function matchType(types: TypeRow[], typeHint: string, text: string): TypeRow | null {
  const hint = words(typeHint);
  const body = typeHint === text ? [] : words(text);
  let best: { row: TypeRow; score: number } | null = null;
  for (const row of types) {
    if (row.hiddenFromOperator) continue;
    const final = words(row.finalType);
    const signs = words([row.sign1, row.sign2, row.sign3].filter(Boolean).join(" "));
    let score = 0;
    for (const w of hint) score += Math.max(3 * wordMatch(w, final), 1.5 * wordMatch(w, signs));
    for (const w of body) score += Math.max(0.25 * wordMatch(w, final), 0.1 * wordMatch(w, signs));
    // Words of the name that the hint does not mention make the leaf more specific than asked.
    score -= 0.4 * final.filter((w) => !hint.some((h) => wordMatch(h, [w]) >= 0.8)).length;
    if (negated(typeHint) !== negated(row.finalType)) score -= 3;
    if (!best || score > best.score) best = { row, score };
  }
  return best && best.score > 0.5 ? best.row : null;
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
  "«Принята» или «Не принята» — не позже 30 секунд после «Добавлена»",
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
  const type = (hints.typeCode ? types.find((t) => t.code === hints.typeCode) : undefined) ?? matchType(types, extracted.typeHint, text);
  const group = type ? await db.incidentGroup.findUnique({ where: { id: type.groupId } }) : null;

  const known = extracted.address.street ? lookupAddress(extracted.address.street, extracted.address.house) : null;
  // A street the tickets do not have may still be in the gazetteer: its district brings the territorial services.
  const byStreet = known || hints.address ? null : placeOfStreet(extracted.address.street);
  const address: IncidentAddress = hints.address
    ? { country: "Россия", subject: "Москва", city: "Москва", ...hints.address }
    : {
        country: "Россия",
        subject: "Москва",
        city: extracted.address.city ?? "Москва",
        street: known?.street ?? extracted.address.street,
        house: known?.house ?? extracted.address.house,
        district: known?.district ?? byStreet?.district ?? undefined,
        okrug: known?.okrug ?? byStreet?.okrug ?? undefined,
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
        `Создан по тексту${usedModel ? " (модель + правила)" : " (правила, без модели)"}: «${text.slice(0, 300)}». Проверьте тип, службы и адрес перед утверждением.`,
      createdById: actor.id,
    },
  });
  return { id: scenario.id, usedModel, finalType, services: named.length };
}
