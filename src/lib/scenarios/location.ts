/**
 * Location of a scenario — округ and район of its address (ТЗ п. 97: «параметры сценария: тип
 * происшествия, локация, сложность»). The helpers here only compare and print names, so the lesson
 * form can use them in the browser; the location itself is read from the reference address on the
 * server (place.ts).
 */

/** Where a scenario happens. okrug «МО» — Московская область; region — any subject other than Moscow. */
export type ScenarioPlace = { okrug: string | null; district: string | null; region?: string | null };

/** A restriction chosen by the teacher: a whole okrug or one district of it. */
export type LocationFilter = { okrug: string; district?: string | null };

/** Moscow okrugs in the usual order, then Московская область. */
export const OKRUG_ORDER = ["ЦАО", "САО", "СВАО", "ВАО", "ЮВАО", "ЮАО", "ЮЗАО", "ЗАО", "СЗАО", "ЗелАО", "ТиНАО", "МО"];

const nameKey = (s: string | null | undefined) => (s ?? "").trim().toLowerCase().replace(/ё/g, "е");

/** «Тёплый Стан» and «Теплый стан» are the same district. */
export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const k = nameKey(a);
  return k !== "" && k === nameKey(b);
}

export function inLocation(place: ScenarioPlace, filter: LocationFilter | null | undefined): boolean {
  if (!filter) return true;
  if (!sameName(place.okrug, filter.okrug)) return false;
  return !filter.district || sameName(place.district, filter.district);
}

/** «СЗАО, Щукино», «СЗАО», «Московская область», «Тульская область»; empty when unknown. */
export function placeLabel(place: ScenarioPlace | LocationFilter | null | undefined): string {
  if (!place) return "";
  if ("region" in place && place.region && place.okrug !== "МО") return place.region;
  if (place.okrug === "МО") return "Московская область";
  if (!place.okrug) return place.district ?? "";
  return place.district ? `${place.okrug}, ${place.district}` : place.okrug;
}

/** Select and URL value: «СЗАО» or «СЗАО|Щукино». */
export function encodeLocation(filter: LocationFilter | null | undefined): string {
  if (!filter?.okrug) return "";
  return filter.district ? `${filter.okrug}|${filter.district}` : filter.okrug;
}

export function decodeLocation(value: string | null | undefined): { okrug: string; district: string | null } | null {
  const [okrug, district] = (value ?? "").split("|").map((s) => s.trim());
  if (!okrug) return null;
  return { okrug: okrug.slice(0, 20), district: district ? district.slice(0, 80) : null };
}

export type LocationGroup = { okrug: string; count: number; districts: { name: string; count: number }[] };

/** Places counted by okrug and district, in the usual order of okrugs, for the selects. */
export function groupLocations(places: ScenarioPlace[]): LocationGroup[] {
  const byOkrug = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  for (const p of places) {
    if (!p.okrug) continue;
    const okrug = OKRUG_ORDER.find((o) => sameName(o, p.okrug)) ?? p.okrug;
    totals.set(okrug, (totals.get(okrug) ?? 0) + 1);
    const districts = byOkrug.get(okrug) ?? new Map<string, number>();
    byOkrug.set(okrug, districts);
    if (p.district) {
      const known = [...districts.keys()].find((d) => sameName(d, p.district));
      const name = known ?? p.district;
      districts.set(name, (districts.get(name) ?? 0) + 1);
    }
  }
  const order = (o: string) => (OKRUG_ORDER.indexOf(o) + 1 || 99);
  return [...byOkrug.entries()]
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b, "ru"))
    .map(([okrug, districts]) => ({
      okrug,
      count: totals.get(okrug) ?? 0,
      districts: [...districts.entries()].sort(([a], [b]) => a.localeCompare(b, "ru")).map(([name, count]) => ({ name, count })),
    }));
}
