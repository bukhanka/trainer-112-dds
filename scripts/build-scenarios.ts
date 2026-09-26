/**
 * Build data/scenarios.json (Scenario rows) and data/addresses.json from the tickets.
 *
 *   pnpm exec tsx scripts/build-scenarios.ts
 *
 * For every ticket situation: the AI caller persona, the reference 112 card (types, flags,
 * address, services by the routing engine, required questions), the card as a ДДС sees it,
 * a difficulty estimate; for the 15 deep tickets also the ДДС reference.
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  referenceFromJson,
  selectServices,
  type ClassifierJson,
  type RoutingFlags,
  type ServicesJson,
} from "../src/lib/routing/engine";
import type { CallerPersona, CallerStatus, IncidentAddress } from "../src/lib/incident/types";
import { TICKETS, type Ticket, type TicketAddress } from "./tickets";
import { DEEP, DDS_RULES } from "./deep-scenarios";

const ROOT = path.join(__dirname, "..");
const DATA = path.join(ROOT, "data");

type ClassifierType = ClassifierJson["types"][number] & {
  groupId: number;
  subgroup: string | null;
  sign2: string | null;
  sign3: string | null;
  questions: string[];
  hiddenFromOperator: boolean;
};

const classifier = JSON.parse(readFileSync(path.join(DATA, "classifier.json"), "utf8")) as { types: ClassifierType[] };
const servicesJson = JSON.parse(readFileSync(path.join(DATA, "services.json"), "utf8")) as ServicesJson;
const kinds = JSON.parse(readFileSync(path.join(DATA, "incident-kinds.json"), "utf8")) as {
  kinds: { name: string; groupId?: number; subgroup?: string }[];
};
const reference = referenceFromJson(classifier, servicesJson);

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();
const typeByName = new Map(classifier.types.map((t) => [norm(t.finalType), t]));
const serviceByName = new Map(servicesJson.map((s) => [norm(s.shortName), s]));

function typeOf(name: string): ClassifierType {
  const t = typeByName.get(norm(name));
  if (!t) throw new Error(`unknown final type «${name}»`);
  return t;
}

function serviceOf(name: string) {
  const s = serviceByName.get(norm(name));
  if (!s) throw new Error(`unknown service «${name}»`);
  return s;
}

function phone(raw?: string): string | undefined {
  if (!raw) return undefined;
  const d = raw.replace(/\D/g, "").replace(/^[78](?=\d{10}$)/, "");
  if (d.length !== 10) return raw;
  return `+7 (${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6, 8)}-${d.slice(8)}`;
}

function sexOf(t: Ticket): "m" | "f" {
  if (t.sex) return t.sex;
  const parts = t.who.split(/\s+/);
  const patronymic = parts[2] ?? "";
  if (/(вна|чна|кызы)$/i.test(patronymic)) return "f";
  if (/(вич|ич|оглы)$/i.test(patronymic)) return "m";
  return /а$/i.test(parts[0] ?? "") ? "f" : "m";
}

const RELATIVE = /^(мама|папа|муж|жена|дочь|сын|брат|сестра|бабушка|дедушка|отец|мать|супруг|супруга)$/;
const ACQUAINTANCE = /^(сосед|соседка|подруга|друг|знакомый|знакомая|бывший муж|бывшая супруга)$/;
const VICTIM = /^(сам себе|сама себе|пострадавший|пострадавшая|потерпевший|владелец)$/;

function callerStatus(role: string): CallerStatus {
  if (RELATIVE.test(role)) return "родственник";
  if (ACQUAINTANCE.test(role)) return "знакомый";
  if (VICTIM.test(role)) return "пострадавший";
  if (/участник/.test(role)) return "участник";
  return "очевидец";
}

function toCardAddress(a: TicketAddress): IncidentAddress {
  const out: IncidentAddress = {
    country: "Россия",
    subject: a.region ?? "Москва",
    city: a.city,
    okrug: a.okrug,
    district: a.district,
    street: a.street,
    house: a.house,
    building: a.building,
    structure: a.structure,
    flat: a.flat,
    entrance: a.entrance,
    floor: a.floor,
    code: a.code,
    object: a.object,
    descriptive: a.descriptive,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined && v !== "")) as IncidentAddress;
}

function addressLine(a: TicketAddress): string {
  const parts = [
    a.region,
    a.city && a.city !== "Москва" ? a.city : a.region ? undefined : "Москва",
    a.street,
    a.house && `д. ${a.house}`,
    a.building && `корп. ${a.building}`,
    a.structure && `стр. ${a.structure}`,
    a.entrance && `под. ${a.entrance}`,
    a.floor && `эт. ${a.floor}`,
    a.flat && `кв. ${a.flat}`,
    a.code && `код ${a.code}`,
    a.object,
  ];
  return parts.filter(Boolean).join(", ");
}

/** «что случилось» for the reference card. */
function kindName(t: Ticket, primary?: ClassifierType): string | null {
  if (t.kind) return t.kind;
  if (!primary) return null;
  const exact = kinds.kinds.find((k) => k.groupId === primary.groupId && k.subgroup && norm(k.subgroup) === norm(primary.subgroup ?? ""));
  return (exact ?? kinds.kinds.find((k) => k.groupId === primary.groupId))?.name ?? null;
}

const CATEGORY_QUESTIONS: Record<string, string[]> = {
  пожар: ["Что горит, есть ли открытое пламя", "Есть ли угроза людям, пострадавшие"],
  газ: ["Газ магистральный или баллон", "Есть ли пострадавшие, угроза людям"],
  ДТП: ["Есть ли пострадавшие, заблокированные", "Марки, цвет и номера машин", "Есть ли разлив топлива, возгорание"],
  медицина: ["Возраст и пол больного", "В сознании ли, дышит ли"],
  правопорядок: ["Есть ли оружие", "Сколько участников, приметы", "Есть ли пострадавшие"],
  "человек в опасности": ["Где именно человек и есть ли к нему доступ", "Возраст и состояние"],
  ребёнок: ["Возраст и приметы ребёнка", "Где и когда видели в последний раз"],
  "угроза взрыва": ["Описание предмета или угрозы", "Есть ли люди рядом — отвести, ничего не трогать"],
  обрушение: ["Есть ли угроза людям, пострадавшие"],
  смерть: ["Есть ли признаки насильственной смерти"],
  "городское хозяйство": ["Где именно, какой участок"],
};

function requiredQuestions(t: Ticket, types: ClassifierType[]): string[] {
  const out: string[] = [];
  const add = (q: string) => {
    if (!out.some((x) => norm(x) === norm(q))) out.push(q);
  };
  if (t.hidden) add("Уточнить адрес: первый ответ заявителя неполный или неточный");
  if (t.addr.region) add("Уточнить регион и населённый пункт");
  for (const type of types) for (const q of type.questions) add(q);
  for (const q of DEEP[t.ref]?.questions ?? []) add(q);
  for (const q of t.q ?? []) add(q);
  if (!DEEP[t.ref]?.questions) for (const q of CATEGORY_QUESTIONS[t.cat] ?? []) add(q);
  if (t.cat !== "служебный") add("ФИО и статус заявителя, контактный телефон");
  return out;
}

function autoFacts(t: Ticket): string[] {
  const facts = t.text
    .split(/(?<=[.;])\s+|,\s+(?=[А-ЯЁа-яё«])/)
    .map((s) => s.replace(/[.;]$/, "").trim())
    .filter((s) => s.length > 3);
  const a = t.addr;
  if (a.entrance) facts.push(`Подъезд ${a.entrance}`);
  if (a.floor) facts.push(`Этаж ${a.floor}`);
  if (a.code) facts.push(`Код домофона ${a.code}`);
  if (t.flags?.gas === true) facts.push("Дом газифицирован");
  if (t.flags?.gas === false) facts.push("Дом не газифицирован");
  return facts;
}

function difficulty(t: Ticket, visibleServices: number): number {
  let d = 2;
  if (t.hidden) d += 2;
  if (t.addr.region) d += 1;
  if (!t.addr.street && !t.addr.house) d += 1;
  const flags = Object.values(t.flags ?? {}).filter((v) => v === true).length;
  d += Math.min(2, flags);
  if (visibleServices >= 6) d += 1;
  if (visibleServices >= 9) d += 1;
  if (t.temper === "panic" || t.temper === "angry" || t.temper === "drunk") d += 1;
  if (t.trap?.length) d += 1;
  return Math.max(1, Math.min(10, d));
}

function title(t: Ticket): string {
  const first = t.text.split(/[.,;]/)[0].trim();
  return `${t.ref}. ${first}`;
}

const scenarios = [];
const addressIndex = new Map<string, Record<string, unknown>>();

for (const t of TICKETS) {
  const primaryTypes = t.types.map(typeOf);
  const altTypes = (t.alt ?? []).map(typeOf);
  const primary = primaryTypes[0];
  const flags: RoutingFlags = t.flags ?? {};
  const isMoscow = !t.addr.region;
  const selected = selectServices(
    {
      typeCodes: primaryTypes.map((x) => x.code),
      flags,
      district: t.addr.district,
      okrug: t.addr.okrug,
      region: t.addr.region ?? null,
    },
    reference,
  );
  const services = selected.map((s) => ({
    serviceId: s.serviceId,
    shortName: servicesJson.find((x) => x.id === s.serviceId)!.shortName,
    isMain: s.isMain,
    reason: s.reason,
  }));

  const deep = DEEP[t.ref];
  const sex = sexOf(t);
  const caller: CallerPersona = {
    fullName: t.who,
    role: t.role,
    phone: phone(t.phone),
    visibleAddress: t.said,
    ...(t.hidden ? { hiddenAddress: t.hidden } : {}),
    situation: deep?.situation ?? t.text,
    facts: deep?.facts ?? autoFacts(t),
    temper: deep?.temper ?? t.temper ?? "calm",
    voice: sex === "f" ? "female" : "male",
  };

  const acceptable = [...primaryTypes, ...altTypes].map((x) => x.code);
  const truth = {
    kind: kindName(t, primary),
    typeCodes: primaryTypes.map((x) => x.code),
    acceptableTypeCodes: acceptable,
    finalType: primary?.finalType ?? null,
    tags: primary ? [primary.sign1, primary.sign2, primary.sign3].filter(Boolean) : [],
    flags,
    address: toCardAddress(t.addr),
    addressLine: addressLine(t.addr),
    inMoscow: isMoscow,
    services,
    requiredQuestions: requiredQuestions(t, primaryTypes),
    traps: t.trap ?? [],
  };

  const ddsCard = {
    classLabel: primary?.finalType ?? t.kind ?? null,
    tagsLine: truth.tags.join(" · "),
    flags: {
      victims: Boolean(flags.victims),
      refusedAmbulance: Boolean(flags.refusedAmbulance),
      blocked: Boolean(flags.noAccess),
    },
    address: truth.addressLine,
    descriptive: t.addr.descriptive ?? null,
    description: t.text,
    caller: { fullName: t.who, status: callerStatus(t.role), aon: caller.phone ?? null, provided: caller.phone ?? null },
    services: services.map((s) => s.shortName),
  };

  let ddsReference = null;
  if (deep) {
    const onCard = new Set(services.map((s) => s.serviceId));
    ddsReference = {
      rules: DDS_RULES,
      services: deep.dds.map((d) => {
        const svc = serviceOf(d.service);
        if (!onCard.has(svc.id)) throw new Error(`${t.ref}: ${d.service} is not on the reference card`);
        return { serviceId: svc.id, ...d, service: svc.shortName };
      }),
      ...(deep.notes ? { notes: deep.notes } : {}),
    };
  }

  const visibleCount = services.length;
  scenarios.push({
    ticketRef: t.ref,
    title: title(t),
    category: t.cat,
    difficulty: difficulty(t, visibleCount),
    status: deep ? "APPROVED" : "DRAFT",
    caller,
    truth,
    ddsCard,
    ddsReference,
    approvedSections: deep ? ["caller", "truth", "ddsCard", "ddsReference"] : [],
    teacherNote: deep ? null : "черновик, ждёт проверки преподавателем",
  });

  if (isMoscow && t.addr.district) {
    const key = [t.addr.street, t.addr.house && `д. ${t.addr.house}`, t.addr.building && `корп. ${t.addr.building}`, t.addr.structure && `стр. ${t.addr.structure}`, t.addr.object]
      .filter(Boolean)
      .join(", ");
    const entry = addressIndex.get(key) ?? {
      address: key,
      street: t.addr.street ?? null,
      house: t.addr.house ?? null,
      building: t.addr.building ?? null,
      structure: t.addr.structure ?? null,
      object: t.addr.object ?? null,
      district: t.addr.district,
      okrug: t.addr.okrug,
      confidence: t.addr.confidence ?? "medium",
      tickets: [] as string[],
    };
    (entry.tickets as string[]).push(t.ref);
    addressIndex.set(key, entry);
  }
}

const lines = (items: unknown[]) => "[\n" + items.map((x) => JSON.stringify(x)).join(",\n") + "\n]\n";
writeFileSync(path.join(DATA, "scenarios.json"), lines(scenarios));

const unresolved = TICKETS.filter((t) => !t.addr.region && !t.addr.district).map((t) => ({
  ticket: t.ref,
  said: t.said,
  why: "район по описанию не определить однозначно (МКАД, мост, водоём) — нужна точка на карте",
}));
const addresses = {
  note: "Московские адреса из билетов → район и округ. Назначено вручную по знанию Москвы; confidence — насколько уверены.",
  addresses: [...addressIndex.values()],
  unresolved,
};
writeFileSync(path.join(DATA, "addresses.json"), JSON.stringify(addresses, null, 1) + "\n");

const approved = scenarios.filter((s) => s.status === "APPROVED").length;
console.log(
  `scenarios.json: ${scenarios.length} scenarios (${approved} approved); addresses.json: ${addressIndex.size} Moscow addresses, ${unresolved.length} unresolved`,
);
