/**
 * Location of a scenario from its reference address (Scenario.truth.address): the okrug and district
 * written there, completed by the offline gazetteer when the address names only the street. Nothing
 * is stored: the location always follows the address the teacher sees and edits.
 */
import type { IncidentAddress } from "@/lib/incident/types";
import { parseStreet, places } from "@/lib/op112/gazetteer";
import { normalizeOkrug } from "@/lib/routing/engine";
import { inLocation, sameName, type LocationFilter, type ScenarioPlace } from "./location";

type GazetteerPlace = ReturnType<typeof places>[number];

let byName: Map<string, GazetteerPlace[]> | null = null;

function placesByStreetName(): Map<string, GazetteerPlace[]> {
  if (byName) return byName;
  byName = new Map();
  for (const p of places()) {
    const key = parseStreet(p.street).name;
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), p]);
  }
  return byName;
}

/**
 * District and okrug of a street by the gazetteer. A name the gazetteer holds in several districts
 * gives only their common okrug; an unknown street gives null.
 */
export function placeOfStreet(street: string | null | undefined): { okrug: string | null; district: string | null } | null {
  if (!street?.trim()) return null;
  const parsed = parseStreet(street);
  const all = placesByStreetName().get(parsed.name) ?? [];
  // «Коломенская улица» and «Коломенская набережная» share the name: the kind of street decides.
  const sameType = parsed.type ? all.filter((p) => parseStreet(p.street).type === parsed.type) : all;
  const found = (sameType.length ? sameType : all).filter((p) => !p.subject || p.subject === "Москва");
  if (!found.length) return null;
  const okrugs = [...new Set(found.map((p) => p.okrug).filter(Boolean))];
  const districts = [...new Set(found.map((p) => p.district).filter(Boolean))];
  // A street listed without a district runs through several (Ленинский проспект — from ЦАО to ЮЗАО and beyond):
  // the district and the okrug of a house on it stay open until the caller names the place precisely.
  if (found.some((p) => !p.district)) return { okrug: null, district: null };
  return { okrug: okrugs.length === 1 ? okrugs[0]! : null, district: districts.length === 1 && okrugs.length === 1 ? districts[0]! : null };
}

/** Okrug of a district the gazetteer knows. */
function okrugOfDistrict(district: string): string | null {
  return places().find((p) => sameName(p.district, district))?.okrug ?? null;
}

/** Where the scenario happens, read from its reference 112 card. */
export function scenarioPlace(truth: unknown): ScenarioPlace {
  const t = truth && typeof truth === "object" ? (truth as { address?: IncidentAddress; inMoscow?: boolean }) : {};
  const a = t.address ?? {};
  const subject = a.subject?.trim();
  if ((subject && !/^(г\.?\s*)?москва$/i.test(subject)) || t.inMoscow === false) {
    if (/московская/i.test(subject ?? "")) return { okrug: "МО", district: null, region: "Московская область" };
    return { okrug: null, district: null, region: subject || null };
  }
  let okrug = normalizeOkrug(a.okrug) ?? (a.okrug?.trim() || null);
  let district = a.district?.trim().replace(/^(район|р-н|поселение|пос\.)\s+/i, "") || null;
  if (!okrug || !district) {
    const byStreet = placeOfStreet(a.street);
    if (byStreet && (!okrug || !byStreet.okrug || sameName(okrug, byStreet.okrug))) {
      okrug ??= byStreet.okrug;
      district ??= byStreet.district;
    }
  }
  if (district && !okrug) okrug = okrugOfDistrict(district);
  return { okrug, district, region: null };
}

/**
 * The lesson's location narrows what a place draws by itself (categories, adaptive choice); tasks the
 * teacher marked for the place by hand are dealt wherever they happen.
 */
export function inLessonLocation<T extends { truth: unknown }>(
  pool: T[],
  seat: { scenarioIds: string[] },
  settings: { location?: LocationFilter | null },
): T[] {
  const location = settings.location;
  if (seat.scenarioIds.length || !location) return pool;
  return pool.filter((s) => inLocation(scenarioPlace(s.truth), location));
}

const KIND: Record<string, RegExp> = {
  улица: /улиц|(^|[^а-я])ул\./,
  проспект: /проспект|пр-т|просп\./,
  переулок: /переул|(^|[^а-я])пер\./,
  шоссе: /шоссе|(^|[^а-я])ш\./,
  бульвар: /бульвар|б-р/,
  набережная: /набережн|(^|[^а-я])наб\./,
  проезд: /проезд|пр-д/,
  площадь: /площад|(^|[^а-я])пл\./,
};

/**
 * A street named in free text in any case form — «по Ленинскому проспекту», «на Кутузовском проспекте»:
 * the gazetteer street whose kind and every name word (without its ending) appear in the text.
 */
export function streetInText(text: string): string | null {
  const t = ` ${text.toLowerCase().replace(/ё/g, "е")} `;
  let best: { street: string; len: number } | null = null;
  for (const p of places()) {
    const { type, name } = parseStreet(p.street);
    if (!type || !name || !KIND[type]?.test(t)) continue;
    const stems = name.split(" ").map((w) => (w.length > 5 ? w.slice(0, -2) : w).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    if (stems.every((s) => new RegExp(`(^|[^а-я0-9])${s}`).test(t)) && (!best || name.length > best.len)) best = { street: p.street, len: name.length };
  }
  return best?.street ?? null;
}

/** «у дома 3», «д. 12а», «дом № 7/2» — the house number exactly as said. */
export function houseInText(text: string): string | undefined {
  return text.match(/(?:^|[^а-яё])(?:дом[ау]?|д\.)\s*№?\s*(\d+[а-яё]?(?:\/\d+)?)(?![\d])/i)?.[1];
}
