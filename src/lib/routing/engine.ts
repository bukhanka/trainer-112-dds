/**
 * Automatic selection of services for a 112 card.
 *
 * Same rule as the customer's system: a plate joins the card when one of its classifier
 * column groups (routeKeys) has a route for the chosen incident type whose condition holds.
 * Territorial duty services (district / settlement + prefecture) come from the address and
 * appear only once the address is resolved down to the district.
 *
 * `selectServices` is pure; `selectServicesFromDb` loads the reference once per process.
 * Data and decisions: data/README.md, docs/data.md.
 */
import type { IncidentFlags } from "@/lib/incident/types";

export const ROUTE_CONDITIONS = [
  "default",
  "always",
  "no_access",
  "threat",
  "victims",
  "victims_absent",
  "offense",
  "gas",
  "med",
  "evac",
  "traffic",
  "tunnel",
  "crossing",
  "road",
  "crowd",
  "construction",
  "object_list",
  "comm",
] as const;
export type RouteCondition = (typeof ROUTE_CONDITIONS)[number];

/** Card flags plus «ав» of the Гормост columns (road bridge / road tunnel), which has no card button yet. */
export type RoutingFlags = IncidentFlags & { road?: boolean };

const FLAG_CONDITIONS: [RouteCondition, (f: RoutingFlags) => boolean | undefined][] = [
  ["no_access", (f) => f.noAccess],
  ["threat", (f) => f.threat],
  ["victims", (f) => f.victims],
  ["victims_absent", (f) => f.victimsAbsent || f.refusedAmbulance],
  ["offense", (f) => f.offense],
  ["gas", (f) => f.gas],
  ["med", (f) => f.med],
  ["evac", (f) => f.evac],
  ["traffic", (f) => f.traffic],
  ["tunnel", (f) => f.tunnel],
  ["crossing", (f) => f.crossing],
  ["road", (f) => f.road],
  ["crowd", (f) => f.crowd],
  ["construction", (f) => f.construction],
  ["object_list", (f) => f.objectList],
  ["comm", (f) => f.comm],
];

/** Human wording of a condition, for reasons shown to the teacher and the trainee. */
export const CONDITION_LABELS: Record<RouteCondition, string> = {
  default: "признак не выбран",
  always: "по типу происшествия",
  no_access: "нет доступа",
  threat: "угроза людям",
  victims: "пострадавшие",
  victims_absent: "пострадавшие не на месте",
  offense: "правонарушение",
  gas: "газификация",
  med: "медицинская помощь",
  evac: "эвакуация",
  traffic: "перекрытие движения",
  tunnel: "тоннель",
  crossing: "пешеходный переход",
  road: "автомобильный мост или тоннель",
  crowd: "более 5 человек / ОД",
  construction: "стройка",
  object_list: "объект из перечня",
  comm: "объект связи",
};

export type RoutingRoute = { routeKey: string; condition: string; label: string };

export type RoutingType = {
  code: number;
  finalType: string;
  sign1: string | null;
  mainService: string | null;
  routes: RoutingRoute[];
};

export type RoutingService = {
  id: number;
  shortName: string;
  routeKeys: string[];
  visible: boolean;
  okrug: string | null;
  district: string | null;
  /** district | prefecture | okrug | tinao_only | street_needs_district | region:<name> | manual | null */
  selectRule: string | null;
  orderIdx: number;
  mainCodes: string[];
};

export type RoutingReference = {
  types: Map<number, RoutingType>;
  services: RoutingService[];
};

export type RoutingInput = {
  typeCodes: number[];
  flags?: RoutingFlags | null;
  district?: string | null;
  okrug?: string | null;
  /** Subject of the address when it is not Moscow, e.g. «Московская область». */
  region?: string | null;
};

export type SelectedService = {
  serviceId: number;
  isMain: boolean;
  reason: string;
  /** Classifier cell for this service: its own incident type or «карточка-112». */
  label?: string;
  visible: boolean;
};

export type SelectOptions = {
  /** Also return listeners that receive the card but are never shown in the strip. */
  includeHidden?: boolean;
};

const MOSCOW = "москва";
const TINAO = "ТиНАО";
const STREET_SIGN = "на улице";

const OKRUG_ALIASES: Record<string, string> = {
  цао: "ЦАО",
  центральный: "ЦАО",
  сао: "САО",
  северный: "САО",
  свао: "СВАО",
  "северо восточный": "СВАО",
  вао: "ВАО",
  восточный: "ВАО",
  ювао: "ЮВАО",
  "юго восточный": "ЮВАО",
  юао: "ЮАО",
  южный: "ЮАО",
  юзао: "ЮЗАО",
  "юго западный": "ЮЗАО",
  зао: "ЗАО",
  западный: "ЗАО",
  сзао: "СЗАО",
  "северо западный": "СЗАО",
  зелао: "ЗелАО",
  зеленоградский: "ЗелАО",
  тинао: TINAO,
  нао: TINAO,
  тао: TINAO,
  новомосковский: TINAO,
  троицкий: TINAO,
  "троицкий и новомосковский": TINAO,
};

// The service list uses a few colloquial district names; official ones map onto them.
const DISTRICT_ALIASES: Record<string, string> = {
  преображенское: "преображенский",
  ивановское: "ивановский",
  "поселение московский": "московское",
  московский: "московское",
};

const REGION_ALIASES: Record<string, string> = {
  мо: "московская область",
  "московская обл": "московская область",
  подмосковье: "московская область",
  "калужская обл": "калужская область",
};

function norm(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[-–—.,«»"()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Note: \b does not work with Cyrillic in JS regexps, so word edges are spelled out.
export function normalizeOkrug(value: string | null | undefined): string | null {
  const key = ` ${norm(value)} `
    .replace(/ (административный|административные|адм) /g, " ")
    .replace(/ (округ|округа|округов|ао) /g, " ")
    .replace(/ (г|города) москвы /g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!key) return null;
  return OKRUG_ALIASES[key] ?? null;
}

export function normalizeDistrict(value: string | null | undefined): string | null {
  let key = norm(value)
    .replace(/^(район|поселение|пос|городской округ|г о|г|упр района|управа района)\s+/, "")
    .replace(/\s+(район|поселение)$/, "")
    .trim();
  if (!key) return null;
  key = DISTRICT_ALIASES[key] ?? key;
  return key;
}

function normalizeRegion(value: string | null | undefined): string | null {
  const key = norm(value).replace(/ обл$/, " область");
  if (!key) return null;
  return REGION_ALIASES[key] ?? key;
}

/** Conditions switched on by the card flags. */
export function activeConditions(flags: RoutingFlags | null | undefined): Set<RouteCondition> {
  const out = new Set<RouteCondition>();
  if (!flags) return out;
  for (const [condition, read] of FLAG_CONDITIONS) if (read(flags)) out.add(condition);
  return out;
}

type Hit = { type: RoutingType; route: RoutingRoute };

/**
 * Routes that fire for one type. Per column group (routeKey): a conditional column whose
 * flag is on wins; if none of the switched-on flags has a value in this group, the
 * «признак не выбран» column applies. «always» columns apply regardless.
 */
export function firingRoutes(type: RoutingType, active: Set<RouteCondition>): RoutingRoute[] {
  const byKey = new Map<string, RoutingRoute[]>();
  for (const r of type.routes) {
    const list = byKey.get(r.routeKey);
    if (list) list.push(r);
    else byKey.set(r.routeKey, [r]);
  }
  const out: RoutingRoute[] = [];
  for (const routes of byKey.values()) {
    const special = routes.filter(
      (r) => r.condition !== "default" && r.condition !== "always" && active.has(r.condition as RouteCondition),
    );
    const chosen = special.length > 0 ? special : routes.filter((r) => r.condition === "default");
    out.push(...chosen, ...routes.filter((r) => r.condition === "always"));
  }
  return out;
}

function describe(hit: Hit): string {
  const condition = CONDITION_LABELS[hit.route.condition as RouteCondition] ?? hit.route.condition;
  if (hit.route.condition === "always" || hit.route.condition === "default") return hit.type.finalType;
  return `${hit.type.finalType} — ${condition}`;
}

function mainServiceId(types: RoutingType[], services: RoutingService[]): number | undefined {
  for (const type of types) {
    const codes = (type.mainService ?? "").split(",").map((c) => c.trim()).filter(Boolean);
    for (const code of codes) {
      const svc = services.find((s) => s.mainCodes.includes(code));
      if (svc) return svc.id;
    }
  }
  return undefined;
}

/** Pick the services for a card. Main service first, then the order of the plates strip. */
export function selectServices(
  input: RoutingInput,
  reference: RoutingReference,
  options: SelectOptions = {},
): SelectedService[] {
  const types = input.typeCodes
    .map((code) => reference.types.get(code))
    .filter((t): t is RoutingType => Boolean(t));
  if (types.length === 0) return [];

  const active = activeConditions(input.flags);
  const hitsByKey = new Map<string, Hit[]>();
  for (const type of types) {
    for (const route of firingRoutes(type, active)) {
      const list = hitsByKey.get(route.routeKey);
      if (list) list.push({ type, route });
      else hitsByKey.set(route.routeKey, [{ type, route }]);
    }
  }

  // Territory: a district alone is enough, its okrug comes from the service list.
  const districtKey = normalizeDistrict(input.district);
  const districtService = districtKey
    ? reference.services.find((s) => s.selectRule === "district" && normalizeDistrict(s.district) === districtKey)
    : undefined;
  const okrug = districtService?.okrug ?? normalizeOkrug(input.okrug);
  const districtResolved = Boolean(districtService);
  const region = normalizeRegion(input.region);

  const mainId = mainServiceId(types, reference.services);
  const picked: SelectedService[] = [];

  for (const svc of reference.services) {
    if (!svc.visible && !options.includeHidden) continue;
    const rule = svc.selectRule ?? "";
    if (rule === "manual") continue;

    if (rule.startsWith("region:")) {
      const target = normalizeRegion(rule.slice("region:".length));
      if (region && region !== MOSCOW && region === target) {
        picked.push({ serviceId: svc.id, isMain: false, reason: `адрес вне Москвы: ${rule.slice(7)}`, visible: svc.visible });
      }
      continue;
    }

    let hits = svc.routeKeys.flatMap((k) => hitsByKey.get(k) ?? []);
    if (rule === "street_needs_district" && !districtResolved) {
      // Street types reach the city-economy plate only through the district (see data/README.md).
      hits = hits.filter((h) => !(h.route.routeKey === "city_economy" && norm(h.type.sign1) === STREET_SIGN));
    }
    if (hits.length === 0) continue;

    let reason = describe(hits[0]);
    if (rule === "district") {
      if (!districtService || districtService.id !== svc.id) continue;
      reason = `ДДС района по адресу: ${svc.district}`;
    } else if (rule === "prefecture") {
      if (!districtResolved || svc.okrug !== okrug) continue;
      reason = `ДДС префектуры округа: ${svc.okrug}`;
    } else if (rule === "okrug") {
      if (!okrug || svc.okrug !== okrug) continue;
      reason = `${describe(hits[0])}; дороги округа ${svc.okrug}`;
    } else if (rule === "tinao_only") {
      if (okrug !== TINAO) continue;
      reason = `${describe(hits[0])}; адрес в ТиНАО`;
    }

    picked.push({
      serviceId: svc.id,
      isMain: svc.id === mainId,
      reason,
      label: hits[0].route.label,
      visible: svc.visible,
    });
  }

  const order = new Map(reference.services.map((s) => [s.id, s.orderIdx]));
  return picked.sort(
    (a, b) =>
      Number(b.isMain) - Number(a.isMain) ||
      (order.get(a.serviceId) ?? 0) - (order.get(b.serviceId) ?? 0) ||
      a.serviceId - b.serviceId,
  );
}

// ─── Reference from the JSON files (tests, scripts) ─────────────────────────

export type ClassifierJson = {
  types: {
    code: number;
    finalType: string;
    sign1: string | null;
    mainService: string | null;
    routes: [string, string, string][];
  }[];
};

export type ServicesJson = (RoutingService & Record<string, unknown>)[];

export function referenceFromJson(classifier: ClassifierJson, services: ServicesJson): RoutingReference {
  const types = new Map<number, RoutingType>();
  for (const t of classifier.types) {
    types.set(t.code, {
      code: t.code,
      finalType: t.finalType,
      sign1: t.sign1,
      mainService: t.mainService,
      routes: t.routes.map(([routeKey, condition, label]) => ({ routeKey, condition, label })),
    });
  }
  return {
    types,
    services: services.map((s) => ({
      id: s.id,
      shortName: s.shortName,
      routeKeys: s.routeKeys,
      visible: s.visible,
      okrug: s.okrug,
      district: s.district,
      selectRule: s.selectRule,
      orderIdx: s.orderIdx,
      mainCodes: s.mainCodes ?? [],
    })),
  };
}

// ─── Reference from the database, cached per process ───────────────────────

const CACHE_TTL_MS = 5 * 60_000;
let cached: { at: number; reference: RoutingReference } | null = null;
let loading: Promise<RoutingReference> | null = null;

async function loadFromDb(): Promise<RoutingReference> {
  const { db } = await import("@/lib/db");
  const [types, routes, services] = await Promise.all([
    db.incidentType.findMany({ select: { code: true, finalType: true, sign1: true, mainService: true } }),
    db.route.findMany({ select: { typeCode: true, routeKey: true, condition: true, label: true } }),
    db.service.findMany(),
  ]);
  const byCode = new Map<number, RoutingType>();
  for (const t of types) byCode.set(t.code, { ...t, routes: [] });
  for (const r of routes) byCode.get(r.typeCode)?.routes.push({ routeKey: r.routeKey, condition: r.condition, label: r.label });
  return {
    types: byCode,
    services: services.map((s) => ({
      id: s.id,
      shortName: s.shortName,
      routeKeys: s.routeKeys,
      visible: s.visible,
      okrug: s.okrug,
      district: s.district,
      selectRule: s.selectRule,
      orderIdx: s.orderIdx,
      mainCodes: s.mainCodes ?? [],
    })),
  };
}

/** Classifier and services from the database; loaded once, refreshed every few minutes. */
export async function getRoutingReference(): Promise<RoutingReference> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.reference;
  loading ??= loadFromDb().finally(() => {
    loading = null;
  });
  const reference = await loading;
  cached = { at: Date.now(), reference };
  return reference;
}

/** Call after the reference data is reloaded (seed, admin import). */
export function invalidateRoutingReference(): void {
  cached = null;
}

export async function selectServicesFromDb(input: RoutingInput, options?: SelectOptions): Promise<SelectedService[]> {
  return selectServices(input, await getRoutingReference(), options);
}
