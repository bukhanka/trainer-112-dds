/**
 * Drafts by category (ТЗ: «генерация сценариев по категории (ДТП, пожары, медицина…) из классификатора
 * и билетов — заранее, до урока; всё сгенерированное — черновик до утверждения»).
 *
 * Rules decide everything that must be right: which classifier leaves of the category to use, a real
 * address in the chosen округ / район from the offline gazetteer, the flags a leaf implies and the
 * difficulty. The model, when one is connected, only writes the caller's story in the style of the
 * tickets — who calls, what they see, the place said the way people say it, details given only on
 * questions. Without a model the story comes from a template. Each draft then goes through the same
 * pipeline as «Сценарий из текста» (generate.ts): services by the routing engine, mandatory questions,
 * the reference for ДДС places. Nothing is approved automatically.
 */
import { z } from "zod";
import type { IncidentType } from "@prisma/client";
import { closeness } from "@/lib/adaptive/pick";
import { chatJson, llmConfigured } from "@/lib/ai/provider";
import { db } from "@/lib/db";
import type { CallerPersona, IncidentAddress, IncidentFlags } from "@/lib/incident/types";
import { parseStreet, places } from "@/lib/op112/gazetteer";
import { confusablePairs, lookupAddress, streetKey } from "@/lib/routing/address";
import { getRoutingReference, selectServices, type RoutingReference } from "@/lib/routing/engine";
import { categoryDef, typeInCategory, type CategoryDef } from "./categories";
import { generateScenarioDraft, type Extracted } from "./generate";
import { inLocation, placeLabel, type LocationFilter } from "./location";

export const MAX_DRAFTS = 5;

export type TypeRow = Pick<IncidentType, "code" | "groupId" | "subgroup" | "finalType" | "sign1" | "sign2" | "sign3" | "questions" | "hiddenFromOperator">;
type Temper = NonNullable<CallerPersona["temper"]>;
type Random = () => number;

const low = (s: string) => s.toLowerCase().replace(/ё/g, "е");
const pick = <T>(list: readonly T[], random: Random): T => list[Math.floor(random() * list.length) % list.length];
const typeText = (t: TypeRow) => [t.finalType, t.subgroup, t.sign1, t.sign2, t.sign3].filter(Boolean).join(" ");

// ─── classifier leaves of the category ───────────────────────────────────────

/** Leaves a generated story must not touch. */
const SENSITIVE = /изнасил|развратн|части тела/i;
/** Leaves that need a place a street address cannot give: metro, railway, water, forest, bridges, pipelines. */
const OFF_STREET =
  /метро|мцк|аэропорт|воздушн|водн(ый|ом|ого) транспорт|судн|причал|(^|[^а-яё])порт([^а-яё]|$)|ж\/д|(^|[^а-яё])жд([^а-яё]|$)|вокзал|платформ|поезд|электричк|тоннел|эстакад|(^|[^а-яё])мост|путепровод|мкад|трасс|(^|[^а-яё])лес(у|а|ом|ной|ном)?([^а-яё]|$)|торф|гидро|нефте|газохранил|водо[её]м|льдин|тонет|утон|в воде|в воду|утопл/i;

/**
 * Leaves of the category a caller can report from a city street: visible to the operator, not tied to
 * the metro, the railway or water. A category that has only such leaves keeps them.
 */
export function candidateTypes(def: CategoryDef, types: TypeRow[]): TypeRow[] {
  const own = types.filter((t) => typeInCategory(def, t) && !t.hiddenFromOperator && !SENSITIVE.test(typeText(t)));
  const street = own.filter((t) => !OFF_STREET.test(typeText(t)));
  return street.length ? street : own;
}

/** Flags that follow from the leaf itself, the way the tickets set them. */
export function impliedFlags(t: TypeRow): IncidentFlags {
  const text = low(typeText(t));
  const f: IncidentFlags = {};
  if (/без пострадав/.test(text)) f.victims = false;
  else if (t.groupId === 22 || /пострадав|ранен|травм|без сознания|в крови|ожог|избит|телесн|погибш|отравлен|сбит|падени/.test(text)) f.victims = true;
  if (/заблокир|зажал|зажат|придавил|закрыт в|заперт|открыть дверь|застрял/.test(text)) f.noAccess = true;
  if (/крики о помощи|кричит о помощи|насильно|на высоте|суицид/.test(text)) f.threat = true;
  if (t.groupId !== 22 && (t.groupId === 4 || /скрыл|драк|хулиган|ножев|огнестрел|телесн|грабеж|разбой|похищ/.test(text))) f.offense = true;
  if (/перекрыт/.test(text)) f.traffic = true;
  return f;
}

// ─── difficulty ──────────────────────────────────────────────────────────────

/** How the place is said first: 0 — street and house at once; 1 — street and a landmark; 2 — only the district and a landmark. */
export type AddressStyle = 0 | 1 | 2;
export type Presentation = { style: AddressStyle; temper: Temper };

const HARD_TEMPERS: Temper[] = ["panic", "angry", "drunk"];

/**
 * The same scale as the ticket scenarios (scripts/build-scenarios.ts), so that generated drafts sit
 * next to the tickets in adaptive choice: base 2, the exact address only on request +2, only a
 * landmark at first +1, flags up to +2, 6 and 9 services on the card +1 each, a hard caller +1, a look-alike street +1.
 */
export function suggestDifficulty(p: { style: AddressStyle; flags: IncidentFlags; services: number; temper: Temper; traps: number }): number {
  let d = 2;
  if (p.style >= 1) d += 2;
  if (p.style === 2) d += 1;
  d += Math.min(2, Object.values(p.flags).filter((v) => v === true).length);
  if (p.services >= 6) d += 1;
  if (p.services >= 9) d += 1;
  if (HARD_TEMPERS.includes(p.temper)) d += 1;
  if (p.traps > 0) d += 1;
  return Math.max(1, Math.min(10, d));
}

/** Presentation for a difficulty the teacher asked for; without one the system varies it. */
export function presentationFor(difficulty: number | null, random: Random): Presentation {
  if (difficulty == null) {
    const r = random();
    // Mostly like the tickets (difficulty 2–7): the exact place or a street with a landmark, rarely only the district.
    const style: AddressStyle = r < 0.45 ? 0 : r < 0.9 ? 1 : 2;
    return { style, temper: style === 2 ? pick(HARD_TEMPERS, random) : pick<Temper>(["calm", "calm", "elderly", "panic"], random) };
  }
  if (difficulty <= 3) return { style: 0, temper: "calm" };
  if (difficulty <= 5) return { style: 1, temper: random() < 0.3 ? "elderly" : "calm" };
  if (difficulty <= 7) return { style: 1, temper: pick<Temper>(["panic", "angry"], random) };
  return { style: 2, temper: pick(HARD_TEMPERS, random) };
}

/** The part of the difficulty that comes from the leaf itself: flags and services on the card. */
function typeWeight(t: TypeRow, services: number): number {
  return 2 + Math.min(2, Object.values(impliedFlags(t)).filter((v) => v === true).length) + (services >= 6 ? 1 : 0) + (services >= 9 ? 1 : 0);
}

function presentationWeight(p: Presentation): number {
  return (p.style >= 1 ? 2 : 0) + (p.style === 2 ? 1 : 0) + (HARD_TEMPERS.includes(p.temper) ? 1 : 0);
}

// ─── addresses ───────────────────────────────────────────────────────────────

export type GenPlace = { street: string; house: string; building?: string; structure?: string; district: string; okrug: string };

/** Railway kilometres, the ring roads and the like are no address for a caller. */
const NOT_A_STREET = /мжд|(^|\s)\d+(-й)?\s*км|кольцо|мкад|ттк/i;

/** Moscow streets of the gazetteer with a known district, in the chosen location. */
export function streetsIn(location: LocationFilter | null) {
  const seen = new Set<string>();
  return places().filter((p) => {
    if (!p.district || !p.okrug || p.okrug === "МО" || (p.subject && p.subject !== "Москва") || NOT_A_STREET.test(p.street)) return false;
    if (!inLocation({ okrug: p.okrug, district: p.district }, location)) return false;
    const key = `${parseStreet(p.street).name}|${low(p.district)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * A real address: the street of the gazetteer; the house of a ticket address on that street when the
 * tickets have one, otherwise a small house number that exists on almost any street.
 */
export function pickPlace(location: LocationFilter | null, random: Random, avoid: Set<string> = new Set()): GenPlace | null {
  const all = streetsIn(location);
  if (!all.length) return null;
  const fresh = all.filter((p) => !avoid.has(streetKey(p.street)));
  const p = pick(fresh.length ? fresh : all, random);
  const ticket = lookupAddress(p.street);
  const fromTicket = ticket?.house && ticket.district && low(ticket.district) === low(p.district!) ? ticket : null;
  return {
    street: p.street,
    house: fromTicket?.house ?? String(1 + Math.floor(random() * 40)),
    ...(fromTicket?.building ? { building: fromTicket.building } : {}),
    ...(fromTicket?.structure ? { structure: fromTicket.structure } : {}),
    district: p.district!,
    okrug: p.okrug!,
  };
}

const STREET_WORDS: [RegExp, string][] = [
  [/(^|\s)ул\.(?=\s|$)/, "$1улица"],
  [/(^|\s)пр-т(?=\s|$)/, "$1проспект"],
  [/(^|\s)пр-д(?=\s|$)/, "$1проезд"],
  [/(^|\s)пер\.(?=\s|$)/, "$1переулок"],
  [/(^|\s)ш\.(?=\s|$)/, "$1шоссе"],
  [/(^|\s)(б-р|бульв\.)(?=\s|$)/, "$1бульвар"],
  [/(^|\s)наб\.(?=\s|$)/, "$1набережная"],
  [/(^|\s)пл\.(?=\s|$)/, "$1площадь"],
];

/** «ул. Берзарина» → «улица Берзарина»: people do not say abbreviations. */
export function spokenStreet(street: string): string {
  return STREET_WORDS.reduce((s, [re, word]) => s.replace(re, word), street).trim();
}

/** «улица Рогова, дом 12, корпус 2»: the exact place, as the caller says it on request. */
export function spokenExact(p: GenPlace): string {
  return [spokenStreet(p.street), `дом ${p.house}`, p.building && `корпус ${p.building}`, p.structure && `строение ${p.structure}`].filter(Boolean).join(", ");
}

const LANDMARKS = [
  "у продуктового магазина",
  "возле автобусной остановки",
  "напротив школы",
  "рядом с аптекой",
  "у детской площадки",
  "за поликлиникой",
  "во дворе, рядом с гаражами",
  "у почтового отделения",
];

function districtSpoken(p: GenPlace): string {
  return p.okrug === "ТиНАО" ? `поселение ${p.district}` : `район ${p.district}`;
}

/** A known look-alike of the street (Дубнинская / Дубининская): picking the other one is a critical error. */
export function lookAlikeTrap(street: string): string | null {
  const key = streetKey(street);
  const pair = confusablePairs().find((p) => streetKey(p.a) === key || streetKey(p.b) === key);
  if (!pair) return null;
  const other = streetKey(pair.a) === key ? pair.b : pair.a;
  return `Похожая улица: ${street} и ${other} — переспросить название и район, выбрать из подсказок нужную`;
}

// ─── the story without a model ───────────────────────────────────────────────

const MALE = ["Кузнецов Игорь Петрович", "Соколов Андрей Ильич", "Волков Дмитрий Олегович", "Морозов Сергей Викторович", "Лебедев Павел Андреевич", "Никитин Олег Юрьевич"];
const FEMALE = ["Петрова Ольга Николаевна", "Смирнова Елена Викторовна", "Фёдорова Марина Игоревна", "Орлова Татьяна Павловна", "Зайцева Наталья Сергеевна", "Белова Ирина Алексеевна"];

type Role = { role: string; voice: "male" | "female" };
const ROLES: Record<string, Role[]> = {
  fire: [
    { role: "сосед", voice: "male" },
    { role: "соседка", voice: "female" },
    { role: "очевидец", voice: "male" },
  ],
  road: [
    { role: "водитель", voice: "male" },
    { role: "очевидец", voice: "female" },
    { role: "прохожий", voice: "male" },
  ],
  med: [
    { role: "жена", voice: "female" },
    { role: "дочь", voice: "female" },
    { role: "сын", voice: "male" },
    { role: "соседка", voice: "female" },
  ],
  child: [
    { role: "мама", voice: "female" },
    { role: "папа", voice: "male" },
    { role: "прохожая", voice: "female" },
  ],
  other: [
    { role: "очевидец", voice: "male" },
    { role: "очевидец", voice: "female" },
    { role: "житель дома", voice: "male" },
  ],
};

function rolesFor(t: TypeRow): Role[] {
  if (t.groupId === 1) return ROLES.fire;
  if (t.groupId === 2) return ROLES.road;
  if (t.groupId === 22) return ROLES.med;
  if (t.groupId === 18) return ROLES.child;
  return ROLES.other;
}

/** «Боль в животе» → «боль в животе», but «ДТП», «АЗС» stay as they are. */
const lcFirst = (s: string) => (/^[А-ЯЁA-Z]{2,}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const capFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const ROAD: [RegExp, string][] = [
  [/наезд на пешехода/, "сбили пешехода"],
  [/скрылась/, "сбили человека, машина уехала"],
  [/опасн[а-я]* груз/, "в аварию попала машина с опасным грузом"],
  [/разлив топлива|горючих/, "из машины течёт бензин"],
  [/негорючих/, "из машины что-то разлилось на дорогу"],
  [/горит дымится|с пожаром/, "машина после удара дымится"],
  [/драк/, "водители после аварии дерутся"],
  [/заблокирован|блокирован/, "человека зажало в машине"],
  [/погибш/, "в машине человек не подаёт признаков жизни"],
  [/сход трамвая/, "трамвай сошёл с рельсов"],
  [/движение перекрыто/, "машины перегородили дорогу"],
  [/светофор/, "машина снесла светофор"],
  [/контактн/, "машина врезалась в столб, оборваны провода"],
  [/опор[аы] (освещения|совещения)|мачта освещения/, "машина врезалась в столб освещения"],
  [/открытый люк/, "машина попала колесом в открытый люк"],
  [/препятств/, "машина врезалась в ограждение"],
  [/автоподстав/, "в меня, похоже, врезались нарочно"],
  [/общественн/, "в аварию попал автобус"],
  [/грузов/, "столкнулись грузовик и легковая машина"],
  [/служебн/, "в аварию попала служебная машина"],
];

/** The first words of the caller: what happened, in plain words built from the classifier leaf. */
export function essence(t: TypeRow, flags: IncidentFlags): string {
  const name = t.finalType.trim();
  const text = low(typeText(t));
  switch (t.groupId) {
    case 1: {
      const obj = lcFirst((name.includes(":") ? name.split(":")[1] : "").replace(/\s*\(.*\)\s*$/, "").trim()).replace("дерево, деревья", "деревья");
      const where = name.match(/\((.+)\)/)?.[1];
      if (/сигнализац/.test(text)) return `Сработала пожарная сигнализация${where ? ` — ${where}` : ""}`;
      if (/^запах гари/i.test(name)) return `Сильно пахнет гарью ${name.replace(/^запах гари\s*/i, "")}`.trim();
      if (!obj) return capFirst(name);
      if (/^задымление/i.test(name)) return `Идёт сильный дым — ${obj}`;
      return `${/^(провода|деревья)|(ые|ие)(\s|$)/.test(obj) ? "Горят" : "Горит"} ${obj}`;
    }
    case 2: {
      const phrase = ROAD.find(([re]) => re.test(text))?.[1] ?? "столкнулись две машины";
      return `Авария на дороге: ${phrase}${flags.victims === true ? ", есть пострадавшие" : flags.victims === false ? ", вроде все целы" : ""}`;
    }
    case 13:
      return capFirst(name);
    case 22:
      return `Нужна скорая: ${lcFirst(name)}`;
    case 15:
      return `Нужна полиция: ${lcFirst(name)}`;
    case 17:
      return `Срочно нужна помощь: ${lcFirst(name)}`;
    case 18:
      return `Помогите, ${lcFirst(name)}`;
    case 14:
      return `Нужна аварийная служба: ${lcFirst(name)}`;
    case 4:
    case 19:
      return `Сообщаю: ${lcFirst(name)}`;
    default:
      return `Сообщаю о происшествии: ${lcFirst(name)}`;
  }
}

const ORDINAL = ["первом", "втором", "третьем", "четвёртом", "пятом", "шестом", "седьмом", "восьмом", "девятом", "десятом", "одиннадцатом", "двенадцатом"];
const RESIDENTIAL = /квартир|жил(ой|ом)|подъезд|балкон|лифт|мусоропровод|кухн|лестничн|подвал|электрощит|счетчик|проводк|газов(ая|ой)|многоквартир|частн(ый|ом) дом/;

export type Story = Extracted & { flags: IncidentFlags; traps: string[] };

/** The draft story by rules: persona, place as said by style, facts given only on questions. */
export function storyByTemplate(t: TypeRow, place: GenPlace, presentation: Presentation, random: Random): Story {
  const text = low(typeText(t));
  const flags: IncidentFlags = { ...impliedFlags(t) };
  const facts: string[] = [];
  const role = pick(rolesFor(t), random);
  const fullName = pick(role.voice === "male" ? MALE : FEMALE, random);

  if (RESIDENTIAL.test(text) && !/частн/.test(text)) {
    const floors = pick([5, 9, 12, 14, 17], random);
    flags.gas = t.groupId === 13 || random() < 0.5;
    facts.push(`Дом ${floors} этажей, ${flags.gas ? "газифицирован" : "не газифицирован, плиты электрические"}`);
    facts.push(`Подъезд ${1 + Math.floor(random() * 6)}, квартира на ${ORDINAL[Math.floor(random() * Math.min(floors, ORDINAL.length))]} этаже`);
  } else if (t.groupId === 13) {
    flags.gas = true;
    facts.push("Дом газифицирован");
  }
  if (t.groupId === 1) facts.push(/дым|гари/.test(text) ? "Огня не видно, только дым" : "Видно открытое пламя, валит чёрный дым");
  if (t.groupId === 1 && presentation.style >= 1 && RESIDENTIAL.test(text) && flags.victims !== true) {
    flags.threat = true;
    facts.push("Есть угроза людям: внутри может оставаться пожилая соседка");
  }
  if (t.groupId === 22) {
    const age = 18 + Math.floor(random() * 70);
    facts.push(`Больному ${age} ${age % 10 === 1 && age % 100 !== 11 ? "год" : age % 10 >= 2 && age % 10 <= 4 && (age % 100 < 12 || age % 100 > 14) ? "года" : "лет"}`);
    facts.push(/без сознания/.test(text) ? "Без сознания, но дышит" : "В сознании, дышит тяжело");
  } else if (flags.victims === true) {
    facts.push(`Есть пострадавший: мужчина лет ${25 + Math.floor(random() * 40)}, в сознании, кровь на лице`);
  } else if (flags.victims === false || t.groupId === 1) {
    facts.push("Пострадавших не видно");
  }
  if (t.groupId === 2) {
    facts.push(`Машины: серая легковая и белый фургон, госномер одной А${100 + Math.floor(random() * 900)}ВС`);
    if (flags.traffic) facts.push("Машины стоят поперёк, движение перекрыто");
  }
  if (t.groupId === 15 && /драк|хулиган|скандал|напал|угрож/.test(text)) {
    facts.push(random() < 0.5 ? "Их двое, оружия в руках не видно" : "Их трое, у одного в руках палка");
  }
  if (t.groupId === 18 || /ребен|несовершеннолет|младен/.test(text)) facts.push(`Ребёнку около ${3 + Math.floor(random() * 9)} лет, в синей куртке`);
  if (flags.noAccess) facts.push("Дверь заперта, внутрь не попасть");
  facts.push("Я рядом, могу встретить и показать, куда ехать");

  const landmark = pick(LANDMARKS, random);
  const exact = spokenExact(place);
  const visibleAddress =
    presentation.style === 0 ? exact : presentation.style === 1 ? `${spokenStreet(place.street)}, ${landmark}` : `${districtSpoken(place)}, ${landmark}`;
  const first = essence(t, flags);
  // At an easy level the caller names the victims at once; later they come out only on the question.
  const second = presentation.style === 0 && flags.victims === true && t.groupId !== 2 && t.groupId !== 22 ? " Есть пострадавший." : "";
  const traps = [lookAlikeTrap(place.street)].filter((x): x is string => Boolean(x));
  if (presentation.style === 2) traps.push("Заявитель сначала называет только район и ориентир — без улицы и дома территориальные службы не подберутся");

  return {
    title: `${capFirst(t.finalType)} — ${place.district}`.slice(0, 120),
    caller: {
      fullName,
      role: role.role,
      phone: randomPhone(random),
      visibleAddress,
      ...(presentation.style === 0 ? {} : { hiddenAddress: exact }),
      situation: `${first}.${second}`,
      facts,
      temper: presentation.temper,
      voice: role.voice,
    },
    address: { city: "Москва", street: place.street, house: place.house },
    flags,
    typeHint: t.finalType,
    description: `${first}${flags.victims === true && !/пострадав/.test(first) ? ", есть пострадавшие" : ""}. Ориентир: ${landmark}.`,
    difficulty: 0,
    traps,
  };
}

function randomPhone(random: Random): string {
  const d = () => Math.floor(random() * 10);
  return `+7 (9${d()}${d()}) ${d()}${d()}${d()}-${d()}${d()}-${d()}${d()}`;
}

// ─── the story by the model ──────────────────────────────────────────────────

/** A long answer is cut, not refused: only a missing part sends the draft to the template. */
const text = (min: number, max: number) => z.string().trim().min(min).transform((s) => s.slice(0, max));

const storySchema = z.object({
  title: text(3, 120),
  caller: z.object({
    fullName: text(3, 80),
    role: text(2, 60),
    voice: z.enum(["male", "female"]).catch("female"),
    situation: text(5, 600),
    visibleAddress: text(3, 200),
    hiddenAddress: z.string().trim().max(300).nullable().optional(),
    facts: z.array(text(2, 300)).min(1).transform((f) => f.slice(0, 8)),
  }),
  flags: z
    .object({ victims: z.boolean(), threat: z.boolean(), noAccess: z.boolean(), gas: z.boolean(), traffic: z.boolean() })
    .partial()
    .catch({}),
  description: text(5, 1000),
});

const STORY_PROMPT = `Ты методист учебного центра Системы 112 Москвы и готовишь учебные вызовы для операторов.
По заданному типу происшествия и адресу напиши короткую историю заявителя в стиле экзаменационных билетов: кто звонит, что видит, как называет место и что скажет только на вопросы оператора.
Тип происшествия и точный адрес заданы — не меняй их, не добавляй второе происшествие. Заявитель — обычный житель, говорит простыми словами, без терминов классификатора.
Верни только JSON:
{
 "title": "что случилось, до 80 символов",
 "caller": {
   "fullName": "фамилия, имя и отчество заявителя",
   "role": "кто звонит: сосед, прохожий, водитель, дочь…",
   "voice": "male или female — по имени",
   "situation": "первые слова заявителя от первого лица: одно-два коротких предложения о том, что случилось, без точного адреса",
   "visibleAddress": "как заявитель назовёт место сначала — строго как сказано в поле «как_называет_место»",
   "hiddenAddress": "точный адрес (улица и дом), который он скажет только на уточняющий вопрос, или null, если сразу называет точно",
   "facts": ["3–6 коротких фраз, которые заявитель скажет только на вопрос оператора"]
 },
 "flags": {"victims": true/false, "threat": true/false, "noAccess": true/false, "gas": true/false, "traffic": true/false},
 "description": "описание для карточки 112: суть, ориентир и пострадавшие — в первых 100 символах"
}
Факты — то, о чём оператор обязан спросить: пострадавшие и их состояние, возраст, этажность и газификация дома, доступ, приметы, сколько людей, есть ли оружие. Каждый факт — одна фраза с конкретикой (число, цвет, этаж). Вопросы классификатора, если они даны, должны находить ответ в фактах.
Ориентиры — обычные: магазин, остановка, школа, аптека, двор; без названий организаций и брендов.
Флаг ставь true только если это прямо следует из истории. Пострадавших не придумывай, если тип их не предполагает.`;

const STYLE_TEXT: Record<AddressStyle, string> = {
  0: "сразу точно: улица и номер дома",
  1: "сначала улица и ориентир без номера дома; номер дома — только на уточняющий вопрос",
  2: "сначала только район и ориентир («во дворе за магазином»); улицу и дом — только на уточняющий вопрос",
};

const TEMPER_TEXT: Record<Temper, string> = {
  calm: "спокойный, отвечает по делу",
  panic: "напуган, торопит, говорит сбивчиво",
  elderly: "пожилой человек, говорит медленно, переспрашивает",
  child: "ребёнок",
  drunk: "выпил, отвечает не сразу",
  angry: "раздражён, что его долго расспрашивают",
};

export type StoryExample = { situation: string; visibleAddress: string; hiddenAddress?: string | null; facts: string[] };

/** The model writes the story; null when it is not connected, over the call limit or answers badly. */
export async function storyByModel(
  t: TypeRow,
  groupName: string,
  category: string,
  place: GenPlace,
  presentation: Presentation,
  examples: StoryExample[],
  random: Random,
): Promise<Story | null> {
  if (!llmConfigured()) return null;
  const implied = impliedFlags(t);
  try {
    const out = await chatJson(
      [
        { role: "system", content: STORY_PROMPT },
        {
          role: "user",
          content: JSON.stringify({
            категория: category,
            тип_происшествия: {
              название: t.finalType,
              группа_классификатора: groupName,
              подгруппа: t.subgroup,
              признаки: [t.sign1, t.sign2, t.sign3].filter(Boolean),
              вопросы_классификатора: t.questions,
            },
            точный_адрес: { улица: spokenStreet(place.street), дом: place.house, корпус: place.building, строение: place.structure, район: place.district, округ: place.okrug },
            как_называет_место: STYLE_TEXT[presentation.style],
            характер_заявителя: TEMPER_TEXT[presentation.temper],
            пострадавшие: implied.victims === true ? "есть" : implied.victims === false ? "нет" : "по ситуации",
            примеры_из_билетов: examples,
          }),
        },
      ],
      storySchema,
      { temperature: 0.8, maxTokens: 1100 },
    );
    const exact = spokenExact(place);
    let hidden = out.caller.hiddenAddress?.trim() || undefined;
    // The house must reach the operator one way or the other: without it the card cannot be right.
    const says = (s: string | undefined) => Boolean(s && new RegExp(`(^|\\D)${place.house.replace(/[^0-9а-яё]/gi, "")}(\\D|$)`, "i").test(s));
    if (!says(out.caller.visibleAddress) && !says(hidden)) hidden = exact;
    // «Нет» is kept only where the tickets keep it (gas in a house); other «нет» from the model would add checks nobody asked for.
    const said = Object.entries(out.flags).filter(([k, v]) => v === true || (k === "gas" && (t.groupId === 1 || t.groupId === 13)));
    const flags: IncidentFlags = { ...Object.fromEntries(said), ...implied };
    const traps = [lookAlikeTrap(place.street)].filter((x): x is string => Boolean(x));
    if (presentation.style === 2) traps.push("Заявитель сначала называет только район и ориентир — без улицы и дома территориальные службы не подберутся");
    return {
      title: out.title,
      caller: {
        fullName: out.caller.fullName,
        role: out.caller.role,
        phone: randomPhone(random),
        visibleAddress: out.caller.visibleAddress,
        ...(hidden && hidden !== out.caller.visibleAddress ? { hiddenAddress: hidden } : {}),
        situation: out.caller.situation,
        facts: out.caller.facts,
        temper: presentation.temper,
        voice: out.caller.voice,
      },
      address: { city: "Москва", street: place.street, house: place.house },
      flags,
      typeHint: t.finalType,
      description: out.description,
      difficulty: 0,
      traps,
    };
  } catch (err) {
    console.error("scenario by category: the model did not write the story, a template is used", err instanceof Error ? err.message.slice(0, 200) : err);
    return null;
  }
}

// ─── choosing the leaves ─────────────────────────────────────────────────────

export type TypeChoice = { type: TypeRow; services: number };

/**
 * Weighted draw of a leaf for one draft: leaves the tickets use count twice, leaves the library already
 * has count a third (variety), and with a difficulty asked the leaf's own weight should be near what
 * is left of it after the way the caller speaks. Leaves that bring no service to the card are skipped.
 */
export function pickType(
  candidates: TypeRow[],
  opts: {
    reference: RoutingReference;
    place: GenPlace;
    presentation: Presentation;
    difficulty: number | null;
    ticketCodes: Set<number>;
    usedCodes: Set<number>;
    taken: Set<number>;
    random: Random;
  },
): TypeChoice | null {
  const scored = candidates
    .filter((t) => !opts.taken.has(t.code))
    .map((t) => {
      const services = selectServices({ typeCodes: [t.code], flags: impliedFlags(t), district: opts.place.district, okrug: opts.place.okrug }, opts.reference).filter(
        (s) => s.visible,
      ).length;
      let w = (opts.ticketCodes.has(t.code) ? 2 : 1) * (opts.usedCodes.has(t.code) ? 0.35 : 1);
      if (opts.difficulty != null) w *= closeness(typeWeight(t, services), opts.difficulty - presentationWeight(opts.presentation), 1.2) + 0.02;
      return { type: t, services, w };
    })
    .filter((x) => x.services > 0);
  if (!scored.length) return null;
  const total = scored.reduce((a, x) => a + x.w, 0);
  let r = opts.random() * total;
  for (const x of scored) {
    r -= x.w;
    if (r < 0) return { type: x.type, services: x.services };
  }
  const last = scored[scored.length - 1];
  return { type: last.type, services: last.services };
}

// ─── the whole run ───────────────────────────────────────────────────────────

export type ByCategoryInput = { category: string; count: number; difficulty: number | null; location: LocationFilter | null };

export type CategoryDraft = {
  id: string;
  title: string;
  finalType: string | null;
  address: string;
  place: string;
  difficulty: number;
  usedModel: boolean;
  services: number;
};

export type ByCategoryResult = { ok: true; drafts: CategoryDraft[] } | { ok: false; error: string };

export async function generateByCategory(input: ByCategoryInput, actor: { id: string }, random: Random = Math.random): Promise<ByCategoryResult> {
  const def = categoryDef(input.category);
  if (!def) return { ok: false, error: `Для категории «${input.category}» нет групп классификатора — выберите категорию из списка.` };
  const count = Math.max(1, Math.min(MAX_DRAFTS, Math.round(input.count)));

  const [types, groups, library] = await Promise.all([
    db.incidentType.findMany({
      select: { code: true, groupId: true, subgroup: true, finalType: true, sign1: true, sign2: true, sign3: true, questions: true, hiddenFromOperator: true },
    }),
    db.incidentGroup.findMany({ select: { id: true, name: true } }),
    db.scenario.findMany({
      where: { status: { not: "ARCHIVED" } },
      select: { category: true, source: true, status: true, truth: true, caller: true },
    }),
  ]);
  const candidates = candidateTypes(def, types);
  if (!candidates.length) return { ok: false, error: `В классификаторе нет подходящих типов для категории «${def.name}».` };
  if (!streetsIn(input.location).length) {
    return { ok: false, error: `В справочнике адресов нет улиц в локации «${placeLabel(input.location)}» — выберите округ или «любая».` };
  }

  const codesOf = (truth: unknown) => ((truth as { typeCodes?: unknown } | null)?.typeCodes as number[] | undefined) ?? [];
  const ticketCodes = new Set(library.filter((s) => s.source === "ticket").flatMap((s) => codesOf(s.truth)));
  const usedCodes = new Set(library.flatMap((s) => codesOf(s.truth)));
  // Style samples: tickets of the same category, approved ones first; any tickets when the category has none.
  const tickets = library.filter((s) => s.source === "ticket").sort((a, b) => Number(b.status === "APPROVED") - Number(a.status === "APPROVED"));
  const sameCategory = tickets.filter((s) => s.category === def.name);
  const examples: StoryExample[] = (sameCategory.length ? sameCategory : tickets)
    .slice(0, 2)
    .map((s) => {
      const c = s.caller as CallerPersona;
      return { situation: c.situation, visibleAddress: c.visibleAddress, hiddenAddress: c.hiddenAddress ?? null, facts: (c.facts ?? []).slice(0, 5) };
    });
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const reference = await getRoutingReference();

  // Plans first, by rules, so that one run has different leaves and streets.
  const plans: { type: TypeRow; place: GenPlace; presentation: Presentation }[] = [];
  const taken = new Set<number>();
  const streets = new Set<string>();
  for (let i = 0; i < count; i++) {
    const presentation = presentationFor(input.difficulty, random);
    const place = pickPlace(input.location, random, streets);
    if (!place) break;
    const choice =
      pickType(candidates, { reference, place, presentation, difficulty: input.difficulty, ticketCodes, usedCodes, taken, random }) ??
      pickType(candidates, { reference, place, presentation, difficulty: input.difficulty, ticketCodes, usedCodes, taken: new Set(), random });
    if (!choice) break;
    taken.add(choice.type.code);
    streets.add(streetKey(place.street));
    plans.push({ type: choice.type, place, presentation });
  }
  if (!plans.length) return { ok: false, error: "Не удалось подобрать тип происшествия с службами для этой локации — выберите другую локацию или категорию." };

  // The stories are written at the same time; each call counts against the model budget (provider.ts).
  const stories = await Promise.all(
    plans.map(async (p) => {
      const byModel = await storyByModel(p.type, groupName.get(p.type.groupId) ?? "", def.name, p.place, p.presentation, examples, random);
      return { story: byModel ?? storyByTemplate(p.type, p.place, p.presentation, random), usedModel: Boolean(byModel) };
    }),
  );

  const drafts: CategoryDraft[] = [];
  for (const [i, p] of plans.entries()) {
    const { story, usedModel } = stories[i];
    const address: IncidentAddress = {
      street: p.place.street,
      house: p.place.house,
      ...(p.place.building ? { building: p.place.building } : {}),
      ...(p.place.structure ? { structure: p.place.structure } : {}),
      district: p.place.district,
      okrug: p.place.okrug,
    };
    const services = selectServices(
      { typeCodes: [p.type.code], flags: story.flags, district: p.place.district, okrug: p.place.okrug },
      reference,
    ).filter((s) => s.visible).length;
    const lookAlike = lookAlikeTrap(p.place.street) ? 1 : 0;
    const difficulty =
      input.difficulty ?? suggestDifficulty({ style: p.presentation.style, flags: story.flags, services, temper: p.presentation.temper, traps: lookAlike });
    const where = placeLabel({ okrug: p.place.okrug, district: p.place.district });
    const addressLine = [p.place.street, `д. ${p.place.house}`, p.place.building && `корп. ${p.place.building}`, p.place.structure && `стр. ${p.place.structure}`]
      .filter(Boolean)
      .join(", ");
    const note = [
      `Сгенерирован по категории «${def.name}»: локация — ${input.location ? placeLabel(input.location) : "любая"}; сложность ${difficulty} — ${input.difficulty ? "задана преподавателем" : "предложена системой"}.`,
      `Тип из классификатора: «${p.type.finalType}» (код ${p.type.code}). Адрес из справочника адресов: ${addressLine} (${where}).`,
      usedModel
        ? "Рассказ заявителя написала модель по образцу билетов; тип, адрес, службы и вопросы подобраны правилами."
        : "Рассказ заявителя составлен по шаблону, без модели, — поправьте формулировки своими словами.",
      "Проверьте рассказ, тип, службы и адрес перед утверждением.",
    ].join("\n");

    const result = await generateScenarioDraft({ text: story.caller.situation, difficulty }, actor, {
      extracted: { ...story, difficulty },
      usedModel,
      typeCode: p.type.code,
      address,
      category: def.name,
      traps: story.traps,
      note,
    });
    drafts.push({
      id: result.id,
      title: story.title,
      finalType: result.finalType,
      address: addressLine,
      place: where,
      difficulty,
      usedModel,
      services: result.services,
    });
  }
  return { ok: true, drafts };
}
