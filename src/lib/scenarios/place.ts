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
  let district = a.district?.trim() || null;
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
