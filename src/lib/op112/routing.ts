/**
 * Automatic choice of services for a 112 card («Службы:» plates).
 *
 * Built-in rules reproduce what the customer's screenshots show for 101 (Улица / Транспорт / Дом),
 * 104, ДТП and a few other types, plus the territorial rule: ДДС of the district (or settlement)
 * and ДДС of its prefecture, only when the address is resolved down to the district.
 * The classifier-based engine replaces the built-in rules once it is available.
 */
import type { IncidentAddress, IncidentFlags } from "@/lib/incident/types";
import { rowVisible, questionCard } from "./catalog";
import type { CardAnswers, RoutedService } from "./types";

export type ServiceLite = {
  id: number;
  shortName: string;
  fullName?: string | null;
  kind: string;
  subtype?: string | null;
  okrug?: string | null;
  district?: string | null;
  orderIdx: number;
};

export type RoutingInput = {
  cards: string[];
  answers: Record<string, CardAnswers>;
  flags: IncidentFlags;
  address: IncidentAddress;
};

const S101 = "Служба 101";
const S102 = "Служба 102";
const S103 = "Служба 103";
const S104 = "Служба 104";
const CEMP = "ЦЭМП";
const PRIORITY = [S101, S104, S102, S103, CEMP];

type Pick = { main?: string; add: string[] };

function answerOf(input: RoutingInput, card: string, row: string): string[] {
  const a = input.answers[card] ?? {};
  const r = questionCard(card).rows.find((x) => x.id === row);
  if (r && !rowVisible(r, a)) return [];
  return a[row] ?? [];
}

const FLAME = "Открытое пламя / Дым";

function rules101(input: RoutingInput): Pick {
  const a = (row: string) => answerOf(input, "101", row);
  const f = input.flags;
  const where = a("where")[0];
  const out: Pick = { add: [] };
  const extra = () => {
    if (f.threat) out.add.push(CEMP);
    if (f.gas) out.add.push(S104);
  };
  if (where === "Улица") {
    const sign = a("fireStreet")[0];
    if (!sign) return out;
    if (sign !== FLAME) return { main: S101, add: [] };
    if (!a("streetObject").length) return out; // flame without an object: no plates yet (as on the screenshots)
    out.main = S101;
    out.add.push("ЦОДД", "ОАТИ");
    if (f.offense) out.add.push(S102);
    extra();
    return out;
  }
  if (where === "Транспорт") {
    const sign = a("fireTransport")[0];
    if (!sign) return out;
    if (sign !== FLAME) return { main: S101, add: [] };
    const obj = a("transportObject")[0];
    if (!obj) return out;
    out.main = S101;
    out.add.push(S102, "ЦОДД", "Мос.Без.");
    if (obj === "Общественный транспорт") out.add.push("Деп. ЖКХ", "Мосгортранс", "ОАТИ");
    if (obj === "Метро") out.add.push("Метро");
    if (/Ж\/Д|МЦК|Вокзал/.test(obj)) out.add.push("МЖД");
    if (["Мост", "Эстакада", "Тоннель", "Переход подземный/наземный"].includes(obj)) out.add.push("Гормост");
    extra();
    return out;
  }
  if (where === "Дом") {
    const sign = a("fireHouse")[0];
    if (!sign) return out;
    if (sign !== FLAME) return { main: S101, add: [] };
    const kind = a("houseKind")[0];
    if (!kind) return out;
    out.main = S101;
    if (kind === "Дом многоквартирный") out.add.push(S102, "Деп. ЖКХ", "ЦОДД", "Мос.Без.", "Мослифт");
    else out.add.push("ЦОДД");
    extra();
    return out;
  }
  if (where === "Здание / объект") {
    const sign = a("fireBuilding")[0];
    if (!sign) return out;
    if (sign !== FLAME || !a("buildingKind").length) return { main: S101, add: [] };
    out.main = S101;
    out.add.push(S102, "ЦОДД", "Мос.Без.");
    extra();
    return out;
  }
  if (where === "Опасный объект") {
    if (!a("fireDanger").length) return out;
    return { main: S101, add: [S102, CEMP, "Мос.Без."] };
  }
  return out;
}

function rulesFor(card: string, input: RoutingInput): Pick {
  const f = input.flags;
  switch (card) {
    case "101":
      return rules101(input);
    case "104": {
      if (!answerOf(input, "104", "gasSign").length) return { add: [] };
      const add: string[] = [];
      if (f.threat) add.push(S101, CEMP);
      if (f.noAccess) add.push(S101);
      if (input.address.okrug === "ТиНАО") add.push("Мособлгаз");
      return { main: S104, add };
    }
    case "103":
      return { main: S103, add: f.threat ? [CEMP] : [] };
    case "102":
      return { main: S102, add: [] };
    case "dtp": {
      const add = ["ЦОДД"];
      if (f.victims) add.push(S103);
      if (f.noAccess || answerOf(input, "dtp", "dtpFire").includes("Да")) add.push(S101);
      if (f.threat) add.push(CEMP);
      return { main: S102, add };
    }
    case "explosion":
      return { main: S101, add: [S102, S103, CEMP, "ФСБ", "Мос.Без."] };
    case "terror":
      return { main: S102, add: ["ФСБ", S101, "Мос.Без."] };
    case "collapse":
    case "collapseThreat":
      return { main: S101, add: [CEMP, "Деп. ЖКХ"] };
    case "person":
      return { main: S101, add: [S102] };
    case "child":
      return { main: S102, add: [S103] };
    case "gorhoz":
      return { main: "Деп. ЖКХ", add: [] };
    default:
      return { add: [] };
  }
}

/** Territorial ДДС: the district or settlement plus the prefecture of its okrug. */
export function territorialServices(address: IncidentAddress, catalog: ServiceLite[]): ServiceLite[] {
  const district = address.district?.trim();
  if (!district) return [];
  const local = catalog.find((s) => s.kind === "территориальная" && s.district === district && !isPrefecture(s));
  const okrug = address.okrug?.trim() || local?.okrug || undefined;
  const prefecture = okrug ? catalog.find((s) => isPrefecture(s) && s.okrug === okrug) : undefined;
  return [local, prefecture].filter((s): s is ServiceLite => Boolean(s));
}

function isPrefecture(s: ServiceLite): boolean {
  return s.kind === "территориальная" && (s.subtype ?? "").startsWith("префектура");
}

/** Built-in rules → ordered plates; the main service goes first. */
export function routeServices(input: RoutingInput, catalog: ServiceLite[]): RoutedService[] {
  const byName = new Map(catalog.map((s) => [s.shortName, s]));
  const names: string[] = [];
  let main: string | undefined;
  for (const card of input.cards) {
    const pick = rulesFor(card, input);
    if (pick.main && !main) main = pick.main;
    for (const n of [pick.main, ...pick.add]) if (n && !names.includes(n)) names.push(n);
  }
  if (!names.length) return [];
  if (input.flags.victims && main !== S103) {
    if (!names.includes(S103)) names.push(S103);
    if (!names.includes(CEMP)) names.push(CEMP);
  }
  const rank = (name: string) => {
    if (name === main) return -1;
    const p = PRIORITY.indexOf(name);
    return p >= 0 ? p : 100 + (byName.get(name)?.orderIdx ?? 999);
  };
  const ordered = names
    .map((n) => byName.get(n))
    .filter((s): s is ServiceLite => Boolean(s))
    .sort((a, b) => rank(a.shortName) - rank(b.shortName));
  const result: RoutedService[] = ordered.map((s) => ({ serviceId: s.id, isMain: s.shortName === main, auto: true }));
  // A plain ambulance call is not a matter for the district duty services.
  const territorial = main === S103 && names.length === 1 ? [] : territorialServices(input.address, catalog);
  for (const t of territorial) {
    if (!result.some((r) => r.serviceId === t.id)) result.push({ serviceId: t.id, isMain: false, auto: true });
  }
  return result;
}

/** Auto plates plus the operator's manual additions (auto plates cannot be removed). */
export function mergeManual(auto: RoutedService[], manualIds: number[], catalog: ServiceLite[]): RoutedService[] {
  const known = new Set(catalog.map((s) => s.id));
  const out = [...auto];
  for (const id of manualIds) {
    if (known.has(id) && !out.some((r) => r.serviceId === id)) out.push({ serviceId: id, isMain: false, auto: false });
  }
  return out;
}
