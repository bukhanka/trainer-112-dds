/**
 * What a ДДС place needs from a Scenario, read leniently: the reference data comes from another
 * team member's import and from teachers, so every field is optional and falls back to
 * Scenario.truth / Scenario.caller.
 *
 * Scenario.ddsCard      — the card as the ДДС sees it: header type, «Класс.», tags, address, plates;
 * Scenario.ddsReference — the expected decision of a ДДС: { default?, services?: { [id | shortName]: entry } },
 *                         an array of entries with serviceId, or a single entry.
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
import { STATUS_LABEL } from "./status";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean) : str(v) ? [str(v)!] : [];
const numList = (v: unknown): number[] =>
  Array.isArray(v)
    ? v
        .map((x) => (typeof x === "number" ? x : isObj(x) ? Number(x.id ?? x.serviceId) : Number(x)))
        .filter((n) => Number.isInteger(n) && n > 0)
    : [];

export type DdsCardSpec = {
  cardType?: string; // «Происшествие 101», feed column «Тип происшествия»
  finalTypes: string[]; // «Класс.: пожар: квартира ;»
  typeCodes: number[];
  tags: TagChoice[];
  address: IncidentAddress;
  description?: string;
  caller: IncidentCaller;
  flags: IncidentFlags;
  services: number[]; // plates in display order
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

  const address = (isObj(card.address) ? card.address : isObj(truth.address) ? truth.address : {}) as IncidentAddress;
  const flags = (isObj(card.flags) ? card.flags : isObj(truth.flags) ? truth.flags : {}) as IncidentFlags;
  const finalTypes = strList(card.finalTypes ?? truth.finalTypes);
  const services = numList(card.services).length ? numList(card.services) : numList(truth.services);

  return {
    cardType: str(card.cardType) ?? str(truth.cardType),
    finalTypes,
    typeCodes: numList(card.typeCodes).length ? numList(card.typeCodes) : numList(truth.typeCodes),
    tags: tagList(card.tags).length ? tagList(card.tags) : tagList(truth.tags),
    address,
    description: str(card.description) ?? persona?.situation ?? scenario.title,
    caller,
    flags,
    services,
    important: card.important === true,
  };
}

// ─── Reference decision of a ДДС ────────────────────────────────────────────

export type DdsDecision = "accept" | "reject";

/** What the crew reports by phone; the lines are built from these facts. */
export type CrewPlan = {
  kind?: string; // «аварийная бригада», «электрик»
  work?: string; // what they do on site
  result?: string; // summary for «Работы завершены»
  refuse?: string; // why the right closing is «Отказ от выполнения работ»
};

export type DdsContact = { name: string; phone: string };

export type DdsReferenceEntry = {
  decision: DdsDecision;
  why?: string;
  /** Words that show whom the information was passed to (organisation, «передано», «дубль», «КП №»). */
  transferTo: string[];
  /** Statuses expected after «Принята», e.g. Начало реагирования → Прибытие → Работы завершены. */
  chain: ServiceStatus[];
  /** The final comment should contain at least one of these words. */
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
  return {
    decision,
    why: str(v.why) ?? str(v.reason),
    transferTo: strList(v.transferTo ?? v.transfer),
    chain: statusList(v.chain ?? v.statusChain ?? v.statuses).filter((s) => s !== "ACCEPTED" && s !== "REJECTED"),
    finalMust: strList(v.finalMust ?? v.commentMust ?? v.mustMention),
    crew: { kind: str(crew.kind), work: str(crew.work), result: str(crew.result), refuse: str(crew.refuse) },
    contacts,
    traps: strList(v.traps),
  };
}

/** Reference entry for one service plate, or null when the scenario has none. */
export function referenceFor(raw: unknown, service: { id: number; shortName: string }): DdsReferenceEntry | null {
  if (Array.isArray(raw)) {
    const own = raw.find((e) => isObj(e) && (Number(e.serviceId) === service.id || str(e.service) === service.shortName));
    const any = raw.find((e) => isObj(e) && e.serviceId == null && e.service == null);
    return entryOf(own ?? any);
  }
  if (!isObj(raw)) return null;
  const byService = isObj(raw.services) ? raw.services : raw;
  return (
    entryOf(byService[String(service.id)]) ??
    entryOf(byService[service.shortName]) ??
    entryOf(raw.default) ??
    entryOf(raw)
  );
}

/** Statuses the crew goes through when the reference says nothing. */
export const DEFAULT_CHAIN: ServiceStatus[] = ["STARTED", "ARRIVED", "WORKING", "FINISHED"];

export function crewChain(ref: DdsReferenceEntry | null): ServiceStatus[] {
  if (!ref) return DEFAULT_CHAIN;
  if (ref.decision === "reject") return [];
  return ref.chain.length ? ref.chain : DEFAULT_CHAIN;
}
