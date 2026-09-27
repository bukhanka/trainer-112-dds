/**
 * What a ДДС place needs from a Scenario, read leniently: the reference data comes from the tickets
 * import (data/scenarios.json) and from teachers, so every field is optional and falls back to
 * Scenario.truth / Scenario.caller.
 *
 * Scenario.ddsCard      — the card as the ДДС sees it: classLabel («Класс.»), tagsLine, flags, address,
 *                         description, caller, services (plate short names);
 * Scenario.ddsReference — { rules[], services: [{ serviceId, service, decision, decisionComment, chain,
 *                         brigadeReport, commentMustHave, traps }] }. Extra optional fields understood here:
 *                         transferTo[], contacts[{ name, phone }], crew { work, refuse }, and a `default` entry.
 *
 * One algorithm for every ДДС (#684): a place whose service is not on the scenario's card plays the role
 * of the territorial ДДС of the same level (district or prefecture) — its plate takes that plate's place
 * and that reference entry applies.
 */
import type { ServiceStatus } from "@prisma/client";
import type {
  CallerPersona,
  CallerStatus,
  IncidentAddress,
  IncidentCaller,
  IncidentFlags,
  TagChoice,
} from "@/lib/incident/types";
import { CALLER_STATUSES } from "@/lib/incident/types";
import { PROGRESS, STATUS_LABEL } from "./status";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean) : str(v) ? [str(v)!] : [];
const numList = (v: unknown): number[] =>
  Array.isArray(v)
    ? v
        .map((x) => (typeof x === "number" ? x : isObj(x) ? Number(x.serviceId ?? x.id) : typeof x === "string" && /^\d+$/.test(x) ? Number(x) : NaN))
        .filter((n) => Number.isInteger(n) && n > 0)
    : [];
/** «—» and friends mean «nothing» in the reference data. */
const meaningful = (v: unknown): string | undefined => {
  const s = str(v);
  return s && !/^[-—–.\s]+$/.test(s) ? s : undefined;
};

export type DdsCardSpec = {
  cardType?: string; // «Происшествие 101», feed column «Тип происшествия»
  finalTypes: string[]; // «Класс.: пожар: квартира ;»
  typeCodes: number[];
  tags: TagChoice[];
  address: IncidentAddress;
  description?: string;
  caller: IncidentCaller;
  flags: IncidentFlags;
  /** Plates in display order: ids when the data has them… */
  services: number[];
  /** …or short names, resolved against the service list by the flow. */
  serviceNames: string[];
  important: boolean;
};

export type ScenarioLike = {
  id: string;
  title: string;
  category: string;
  caller: unknown;
  truth: unknown;
  ddsCard?: unknown;
  ddsReference?: unknown;
};

function tagList(v: unknown): TagChoice[] {
  if (typeof v === "string") {
    return v
      .split(/\s+[·.]\s+|\s*·\s*/)
      .map((s) => s.replace(/[.\s]+$/, "").trim())
      .filter(Boolean)
      .map((value) => ({ row: "", value }));
  }
  if (!Array.isArray(v)) return [];
  return v
    .map((t): TagChoice | null => {
      if (typeof t === "string") return t.trim() ? { row: "", value: t.trim() } : null;
      if (isObj(t) && str(t.value)) return { row: str(t.row) ?? "", value: str(t.value)! };
      return null;
    })
    .filter((t): t is TagChoice => !!t);
}

function callerStatus(role: string | undefined): CallerStatus | undefined {
  if (!role) return undefined;
  const lower = role.toLowerCase();
  return CALLER_STATUSES.find((s) => lower.includes(s)) ?? (/(мама|папа|сын|дочь|муж|жена|бабушк|дедушк)/.test(lower) ? "родственник" : undefined);
}

export function personaOf(scenario: Pick<ScenarioLike, "caller">): CallerPersona | null {
  const c = scenario.caller;
  if (!isObj(c) || !str(c.fullName)) return null;
  return {
    fullName: str(c.fullName)!,
    role: str(c.role) ?? "заявитель",
    phone: str(c.phone),
    visibleAddress: str(c.visibleAddress) ?? "",
    hiddenAddress: str(c.hiddenAddress),
    situation: str(c.situation) ?? "",
    facts: strList(c.facts),
    temper: (str(c.temper) as CallerPersona["temper"]) ?? "calm",
    voice: c.voice === "male" || c.voice === "female" ? c.voice : undefined,
  };
}

function flagsOf(raw: unknown): IncidentFlags {
  if (!isObj(raw)) return {};
  const flags = { ...raw } as IncidentFlags & { blocked?: boolean };
  // The ДДС card says «Заблокированные»; the 112 flags call it noAccess.
  if (flags.blocked !== undefined && flags.noAccess === undefined) flags.noAccess = !!flags.blocked;
  delete flags.blocked;
  return flags;
}

/** The card a ДДС place receives for this scenario. */
export function ddsCardOf(scenario: ScenarioLike): DdsCardSpec {
  const card = isObj(scenario.ddsCard) ? scenario.ddsCard : {};
  const truth = isObj(scenario.truth) ? scenario.truth : {};
  const persona = personaOf(scenario);

  const callerRaw = isObj(card.caller) ? card.caller : {};
  const caller: IncidentCaller = {
    fullName: str(callerRaw.fullName) ?? persona?.fullName,
    status: (str(callerRaw.status) as CallerStatus | undefined) ?? callerStatus(persona?.role),
    aon: str(callerRaw.aon) ?? persona?.phone,
    provided: str(callerRaw.provided) ?? persona?.phone,
    onSite: str(callerRaw.onSite),
    channel: str(callerRaw.channel),
  };

  // The address object of the reference card; a plain line only as the last resort.
  const base = (isObj(card.address) ? card.address : isObj(truth.address) ? truth.address : {}) as IncidentAddress;
  const line = str(card.address) ?? str(truth.addressLine);
  const address: IncidentAddress = { ...base };
  if (meaningful(card.descriptive)) address.descriptive = str(card.descriptive);
  if (!Object.keys(base).length && line) address.descriptive = line;

  const finalTypes = strList(card.finalTypes).length
    ? strList(card.finalTypes)
    : strList(card.classLabel).length
      ? strList(card.classLabel)
      : strList(truth.finalType ?? truth.finalTypes);
  const tags = tagList(card.tags).length ? tagList(card.tags) : tagList(card.tagsLine).length ? tagList(card.tagsLine) : tagList(truth.tags);
  const ids = numList(truth.services).length ? numList(truth.services) : numList(card.services);
  const names = Array.isArray(card.services) ? strList(card.services).filter((s) => !/^\d+$/.test(s)) : [];

  return {
    cardType: str(card.cardType) ?? str(truth.kind) ?? str(truth.cardType),
    finalTypes,
    typeCodes: numList(card.typeCodes).length ? numList(card.typeCodes) : numList(truth.typeCodes),
    tags,
    address,
    description: str(card.description) ?? persona?.situation ?? scenario.title,
    caller,
    flags: { ...flagsOf(truth.flags), ...flagsOf(card.flags) },
    services: ids,
    serviceNames: ids.length ? [] : names,
    important: card.important === true,
  };
}

// ─── Territorial roles (#684) ───────────────────────────────────────────────

const PREFECTURE = /^Поселение (ЦАО|САО|СВАО|ВАО|ЮВАО|ЮАО|ЮЗАО|ЗАО|СЗАО|ЗелАО|ТиНАО|ТАО|НАО)$/;

/** «district» — ДДС of a district or a settlement, «prefecture» — ДДС of an okrug, null — not territorial. */
export function territorialLevel(shortName: string): "district" | "prefecture" | null {
  if (!/^Поселение /.test(shortName)) return null;
  return PREFECTURE.test(shortName) ? "prefecture" : "district";
}

/**
 * Plates of a generated card for a place: the scenario's plates with the place's own service on them.
 * A territorial place takes the plate of the same level (it plays that ДДС); anyone else is added at the end.
 */
/**
 * Whether a card with these plates would reach this place in real work: its own service is on it, or a
 * territorial plate of its level (the place plays that ДДС). A card with, say, only «Служба 103» would not.
 */
export function reachesPlace(plateNames: string[], own: { shortName: string }): boolean {
  const level = territorialLevel(own.shortName);
  return plateNames.some((name) => name === own.shortName || (level !== null && territorialLevel(name) === level));
}

export function platesForPlace<T extends { id: number; shortName: string }>(plates: T[], own: T): T[] {
  if (plates.some((p) => p.id === own.id)) return plates;
  const level = territorialLevel(own.shortName);
  const at = level ? plates.findIndex((p) => territorialLevel(p.shortName) === level) : -1;
  if (at < 0) return [...plates, own];
  return plates.map((p, i) => (i === at ? own : p));
}

// ─── Reference decision of a ДДС ────────────────────────────────────────────

export type DdsDecision = "accept" | "reject";

/** What the crew reports by phone; the lines are built from these facts. */
export type CrewPlan = {
  kind?: string; // «аварийная бригада», «электрик»
  work?: string; // what they do on site
  result?: string; // summary for «Работы завершены» (the reference's brigadeReport)
  refuse?: string; // why the right closing is «Отказ от выполнения работ»
};

export type DdsContact = { name: string; phone: string };

export type DdsReferenceEntry = {
  decision: DdsDecision;
  /** Why this decision; for «Не принята» — the expected comment. */
  why?: string;
  /** Words that show whom the information was passed to (organisation, «передано», «дубль», «КП №»). */
  transferTo: string[];
  /** Statuses expected after the first answer, e.g. Начало реагирования → Прибытие → Работы завершены. */
  chain: ServiceStatus[];
  /** What the final comment must contain: keywords or short phrases («что сделано», «кому передано»). */
  finalMust: string[];
  crew: CrewPlan;
  /** Extra numbers for the phone book of this card (a managing company, a utility). */
  contacts: DdsContact[];
  traps: string[];
};

const STATUS_BY_WORD: Record<string, ServiceStatus> = Object.fromEntries([
  ...Object.entries(STATUS_LABEL).map(([k, label]) => [label.toLowerCase(), k as ServiceStatus]),
  ...Object.keys(STATUS_LABEL).map((k) => [k.toLowerCase(), k as ServiceStatus]),
  ["отказ", "REFUSED"],
  ["завершение работ", "FINISHED"],
]);

function statusList(v: unknown): ServiceStatus[] {
  return strList(v)
    .map((s) => STATUS_BY_WORD[s.toLowerCase()])
    .filter((s): s is ServiceStatus => !!s);
}

function decisionOf(v: unknown): DdsDecision | null {
  if (v === true) return "accept";
  if (v === false) return "reject";
  const s = str(v)?.toLowerCase();
  if (!s) return null;
  if (/^(reject|rejected|не\s*принята|не\s*реагировать|отказ)/.test(s)) return "reject";
  if (/^(accept|accepted|принята|реагировать)/.test(s)) return "accept";
  return null;
}

function entryOf(v: unknown): DdsReferenceEntry | null {
  if (!isObj(v)) return null;
  const decision = decisionOf(v.decision ?? v.firstStatus ?? v.primary);
  if (!decision) return null;
  const crew = isObj(v.crew) ? v.crew : isObj(v.brigade) ? v.brigade : {};
  const contacts = Array.isArray(v.contacts)
    ? v.contacts
        .map((c): DdsContact | null => (isObj(c) && str(c.name) && str(c.phone) ? { name: str(c.name)!, phone: str(c.phone)! } : null))
        .filter((c): c is DdsContact => !!c)
    : [];
  const report = meaningful(v.brigadeReport);
  return {
    decision,
    why: str(v.why) ?? str(v.decisionComment) ?? str(v.reason),
    transferTo: strList(v.transferTo ?? v.transfer),
    chain: statusList(v.chain ?? v.statusChain ?? v.statuses).filter((s) => s !== "ACCEPTED" && s !== "REJECTED"),
    finalMust: strList(v.finalMust ?? v.commentMustHave ?? v.mustMention),
    crew: {
      kind: str(crew.kind),
      work: str(crew.work),
      result: str(crew.result) ?? (decision === "accept" ? report : undefined),
      refuse: str(crew.refuse),
    },
    contacts,
    traps: strList(v.traps),
  };
}

/** Reference entry for one service plate, or null when the scenario has none for it or for its role. */
export function referenceFor(raw: unknown, service: { id: number; shortName: string }): DdsReferenceEntry | null {
  const list: unknown[] = Array.isArray(raw) ? raw : isObj(raw) && Array.isArray(raw.services) ? raw.services : [];
  if (list.length) {
    const exact = list.find((e) => isObj(e) && (Number(e.serviceId) === service.id || str(e.service) === service.shortName));
    if (exact) return entryOf(exact);
  }
  if (isObj(raw)) {
    const byService = isObj(raw.services) ? raw.services : null;
    const keyed = byService ? (entryOf(byService[String(service.id)]) ?? entryOf(byService[service.shortName])) : null;
    if (keyed) return keyed;
    const fallback = entryOf(raw.default) ?? (list.length ? null : entryOf(raw));
    if (fallback) return fallback;
  }
  // A territorial place without its own entry plays the territorial ДДС of the same level.
  const level = territorialLevel(service.shortName);
  if (level && list.length) {
    const role = list.find((e) => isObj(e) && territorialLevel(str(e.service) ?? "") === level);
    if (role) return entryOf(role);
  }
  const bare = list.find((e) => isObj(e) && e.serviceId == null && e.service == null);
  return bare ? entryOf(bare) : null;
}

/** Statuses the crew goes through when the reference says nothing. */
export const DEFAULT_CHAIN: ServiceStatus[] = ["STARTED", "ARRIVED", "WORKING", "FINISHED"];

export function crewChain(ref: DdsReferenceEntry | null): ServiceStatus[] {
  if (!ref) return DEFAULT_CHAIN;
  if (ref.decision === "reject") return [];
  return ref.chain.length ? ref.chain : DEFAULT_CHAIN;
}

/** Whether the service sends people at all (an okrug ДДС usually just takes the card «к сведению»). */
export function crewExpected(ref: DdsReferenceEntry | null): boolean {
  return crewChain(ref).some((s) => PROGRESS.includes(s));
}
