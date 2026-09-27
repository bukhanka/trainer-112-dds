/**
 * Offline address helpers for the demo: district and okrug of the ticket addresses
 * (data/addresses.json) and look-alike street names (data/confusable-streets.json),
 * where a wrong street is a critical error.
 */
import addressesJson from "../../../data/addresses.json";
import confusableJson from "../../../data/confusable-streets.json";
import { sayable } from "@/lib/speech/sayable";

export type KnownAddress = {
  address: string;
  street: string | null;
  house: string | null;
  building: string | null;
  structure: string | null;
  object: string | null;
  district: string;
  okrug: string;
  confidence: "high" | "medium" | "low";
  tickets: string[];
};

export type ConfusablePair = {
  a: string;
  aDistrict: string | null;
  aOkrug: string | null;
  b: string;
  bDistrict: string | null;
  bOkrug: string | null;
  kind: "letter" | "size" | "form" | "number" | "place";
  why: string;
};

const ADDRESSES = (addressesJson as { addresses: KnownAddress[] }).addresses;
const PAIRS = (confusableJson as { pairs: ConfusablePair[] }).pairs;

const STREET_WORDS =
  /(^|\s)(ул|улица|пр-т|проспект|пр-д|проезд|пер|переулок|б-р|бульв|бульвар|ш|шоссе|наб|набережная|пл|площадь)(?=\s|$)/g;

/**
 * «ул. Большая Ордынка» and «Большая Ордынка улица» → «большая ордынка». The street is read as it is said
 * («пос. ЛМС, мкр Солнечный» and «посёлок ЛМС, микрорайон Солнечный» are one place; «МКАД, 73 км» and «МКАД,
 * 73-й километр» too), so a trainee who writes down what the caller said is not marked wrong.
 */
export function streetKey(value: string | null | undefined): string {
  return sayable(value ?? "")
    .toLowerCase()
    .replace(/(\d+)-(?:й|го|м|му|ом)(?![\p{L}])/gu, "$1")
    .replace(/(?<![\p{L}])километр\p{L}*/gu, "км")
    .replace(/ё/g, "е")
    .replace(/\(.*?\)/g, " ")
    .replace(/[.,«»"]/g, " ")
    .replace(STREET_WORDS, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function houseKey(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/\s+/g, "").replace(/^(дом|д|владение|вл)\.?/, "");
}

/** District and okrug of an address from the tickets, or null when it is not in the list. */
export function lookupAddress(street: string, house?: string | null): KnownAddress | null {
  const key = streetKey(street);
  if (!key) return null;
  const sameStreet = ADDRESSES.filter((a) => a.street && streetKey(a.street) === key);
  if (sameStreet.length === 0) return null;
  if (house) {
    const exact = sameStreet.find((a) => houseKey(a.house) === houseKey(house));
    if (exact) return exact;
  }
  return sameStreet.length === 1 || !house ? sameStreet[0] : null;
}

function distance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return dp[a.length][b.length];
}

export type StreetCheck =
  | { verdict: "same" }
  | { verdict: "confusable"; pair?: ConfusablePair; distance: number }
  | { verdict: "different" };

/**
 * Compare the street the trainee typed with the reference one.
 * «confusable» — a known look-alike pair or a name one or two letters away: a critical error.
 */
export function compareStreets(typed: string, expected: string): StreetCheck {
  const a = streetKey(typed);
  const b = streetKey(expected);
  if (!a || !b) return { verdict: "different" };
  if (a === b) return { verdict: "same" };
  const pair = PAIRS.find(
    (p) => (streetKey(p.a) === a && streetKey(p.b) === b) || (streetKey(p.a) === b && streetKey(p.b) === a),
  );
  const d = distance(a, b);
  if (pair) return { verdict: "confusable", pair, distance: d };
  if (d <= 2 && Math.min(a.length, b.length) >= 5) return { verdict: "confusable", distance: d };
  return { verdict: "different" };
}

export function confusablePairs(): ConfusablePair[] {
  return PAIRS;
}
