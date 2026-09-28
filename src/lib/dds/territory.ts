/**
 * Territory of a district, settlement or prefecture ДДС, and the cards the system generates for it.
 *
 * A card that comes to such a place is on its territory: otherwise the trainer would teach to accept other districts'
 * incidents, and the right refusal («адрес не наш, передано в ДДС …») would count as a critical mistake. The place
 * draws first the situations that happen on its territory (flow/dds-flow.ts). Then a situation is moved there: the
 * house of the ticket goes to a street of the place's district from the offline gazetteer (op112/gazetteer.ts; for a
 * prefecture — to a district of its okrug); the entrance, floor and flat stay, the object and the descriptive address of
 * the old place go, and the district and prefecture plates follow the new address. Only an ordinary house moves: a
 * station, a park, the ring road, a description that names its place never do. The move is a pure function of the
 * scenario and the place's service, so every poll, the crew and the applicant on the phone meet the same address.
 *
 * A card whose address is not on the place's territory — a task the teacher marked by hand that cannot move, a card
 * typed at a 112 place with another district's plate — is judged as the memo says: «Не принята», whose territory it is
 * and to whom it was passed (foreignReference).
 */
import type { CallerPersona, IncidentAddress } from "@/lib/incident/types";
import { parseStreet, places } from "@/lib/op112/gazetteer";
import { ticketHouses } from "@/lib/routing/address";
import { normalizeDistrict, normalizeOkrug } from "@/lib/routing/engine";
import type { ScenarioPlace } from "@/lib/scenarios/location";
import { scenarioPlace } from "@/lib/scenarios/place";
import { hash } from "./bots";
import { platesForPlace, referenceFor, territorialLevel, type DdsCardSpec, type DdsReferenceEntry } from "./scenario";

export type Territory = { level: "district" | "prefecture"; okrug: string; district: string | null };

type ServiceLike = { shortName: string; okrug?: string | null; district?: string | null };

type GazetteerPlace = ReturnType<typeof places>[number];

const low = (s: string | null | undefined) => (s ?? "").toLowerCase().replace(/ё/g, "е");

/** The ring roads, railway kilometres and the like: no house to move. */
const NOT_A_HOUSE_STREET = /мжд|(^|\s)\d+(-й)?\s*км|кольц|мкад|ттк|\(/i;

/** Long roads that cross several districts: a random house on them may lie in another district. */
const THROUGH_ROAD = /шоссе|проспект|(^|\s)(ш|пр-т|просп)\./i;

/**
 * Places a description may tie the incident to: a station, a park, a shopping centre — such a card cannot move.
 * The lookarounds stand for word edges, which JS regexps do not know in Cyrillic.
 */
const LANDMARK = new RegExp(
  `(^|[^а-я0-9])(${[
    "метро",
    "вокзал",
    "станци",
    "платформ",
    "электричк",
    "мкад",
    "ттк",
    "кольц",
    "лесопарк",
    "парк(е|а|у|ом)?(?![а-я])",
    "сквер",
    "озер",
    "пляж",
    "пруд",
    "набережн",
    "мост(у|а|ом)?(?![а-я])",
    "тоннел",
    "аэропорт",
    "депо",
    "кладбищ",
    "рын(ок|ке|ка|ку)(?![а-я])",
    "торгов\\S* (центр|комплекс)",
    "тц(?![а-я0-9])",
    "тк(?![а-я0-9])",
    "стадион",
    "дворец спорта",
    "частн\\S* дом",
  ].join("|")})`,
);

/** Words of a street or district name too common to point at the place («Большой», «Северное», «Маршала»). */
const COMMON_WORD =
  /^(больш(ая|ой|ое)|мал(ая|ый|ое)|верхн(яя|ий|ее)|нижн(яя|ий|ее)|нов(ая|ый|ое)|стар(ая|ый|ое)|средн(яя|ий|ее)|северн(ая|ый|ое)|южн(ая|ый|ое)|западн(ая|ый|ое)|восточн(ая|ый|ое)|красн(ая|ый|ое)|улица|переулок|проезд|проспект|шоссе|бульвар|площадь|набережная|поселок|деревня|село|город|микрорайон|квартал|маршала|генерала|академика|адмирала|летчика|космонавта|героя|героев|профессора)$/;

// ─── Territory of a place ───────────────────────────────────────────────────

/** Okrug of a district the gazetteer knows. */
function okrugOfDistrict(district: string): string | null {
  const key = normalizeDistrict(district);
  return places().find((p) => p.district && normalizeDistrict(p.district) === key)?.okrug ?? null;
}

/**
 * The territory of a district or prefecture ДДС («Поселение Щукино», «Поселение СЗАО»), from the service's okrug and
 * district (the service list has them) or its name; null for a city or departmental service.
 */
export function territoryOf(service: ServiceLike): Territory | null {
  const level = territorialLevel(service.shortName);
  if (!level) return null;
  const name = service.shortName.replace(/^Поселение\s+/, "").trim();
  if (level === "prefecture") {
    const okrug = normalizeOkrug(service.okrug) ?? normalizeOkrug(name);
    return okrug ? { level, okrug, district: null } : null;
  }
  const district = service.district?.trim() || name;
  const okrug = normalizeOkrug(service.okrug) ?? okrugOfDistrict(district);
  return okrug ? { level, okrug, district } : null;
}

/** Where a card's address is: okrug and district as written, completed by the gazetteer from the street. */
export function placeOfAddress(address: IncidentAddress | null | undefined): ScenarioPlace {
  return scenarioPlace({ address: address ?? {} });
}

/**
 * «in» — the address is on the territory; «out» — it is somewhere else (another district or okrug, outside Moscow);
 * «unknown» — the address does not say enough (no district for a district place).
 */
export function territoryMatch(place: ScenarioPlace, t: Territory): "in" | "out" | "unknown" {
  if (place.region || place.okrug === "МО") return "out";
  const okrug = normalizeOkrug(place.okrug) ?? place.okrug;
  if (!okrug) return "unknown";
  if (okrug !== t.okrug) return "out";
  if (t.level === "prefecture") return "in";
  const district = normalizeDistrict(place.district);
  if (!district) return "unknown";
  return district === normalizeDistrict(t.district) ? "in" : "out";
}

// ─── Moving a card ──────────────────────────────────────────────────────────

/** Word stems of a name that would give the place away in a text («Сухаревский» → «сухаревск»). */
function stemsOf(name: string | null | undefined): string[] {
  return low(name)
    .split(/[^а-я0-9]+/)
    .filter((w) => w.length >= 4 && !/^\d/.test(w) && !COMMON_WORD.test(w))
    .map((w) => (w.length > 5 ? w.slice(0, -2) : w));
}

/** The words of the old place — street, district, the name of an object in quotes — in a text. */
export function namesPlace(text: string, a: IncidentAddress): boolean {
  const t = ` ${low(text)}`;
  const quoted = [...(a.object ?? "").matchAll(/«([^»]+)»/g)].flatMap((m) => stemsOf(m[1]));
  const stems = [...stemsOf(parseStreet(a.street ?? "").name), ...stemsOf(a.district), ...quoted];
  return stems.some((s) => new RegExp(`[^а-я0-9]${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(t));
}

/**
 * Whether a card can be moved to another district: an ordinary house in Moscow whose description does not tie the
 * incident to its place (a station, a park, a named street).
 */
export function movable(spec: Pick<DdsCardSpec, "address" | "description">): boolean {
  const a = spec.address;
  const place = placeOfAddress(a);
  if (place.region || !place.okrug || place.okrug === "МО") return false;
  if (!a.street?.trim() || !a.house?.trim() || NOT_A_HOUSE_STREET.test(a.street)) return false;
  const text = low(spec.description);
  return !LANDMARK.test(` ${text}`) && !LANDMARK.test(` ${low(a.object)}`) && !namesPlace(text, a);
}

const isMoscowStreet = (p: GazetteerPlace) => !!p.district && !!p.okrug && p.okrug !== "МО" && (!p.subject || p.subject === "Москва") && !NOT_A_HOUSE_STREET.test(p.street);

const streetsCache = new Map<string, GazetteerPlace[]>();

/** Streets of a district in the gazetteer, one entry per street; the official and the colloquial name are one district. */
export function streetsOf(district: string): GazetteerPlace[] {
  const key = normalizeDistrict(district) ?? "";
  const cached = streetsCache.get(key);
  if (cached) return cached;
  const seen = new Set<string>();
  const found = places().filter((p) => {
    if (!key || !isMoscowStreet(p) || normalizeDistrict(p.district) !== key) return false;
    const name = parseStreet(p.street).name;
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
  streetsCache.set(key, found);
  return found;
}

/** Whether a card can be moved onto this territory at all: the gazetteer has a street there. */
export function hasStreets(t: Territory): boolean {
  return t.level === "district" ? streetsOf(t.district!).length > 0 : districtsOf(t.okrug).length > 0;
}

/** Districts of an okrug that have streets in the gazetteer, in a stable order. */
function districtsOf(okrug: string): string[] {
  const byKey = new Map<string, string>();
  for (const p of places()) if (isMoscowStreet(p) && normalizeOkrug(p.okrug) === okrug && !byKey.has(normalizeDistrict(p.district)!)) byKey.set(normalizeDistrict(p.district)!, p.district!);
  return [...byKey.entries()].sort(([a], [b]) => a.localeCompare(b, "ru")).map(([, name]) => name);
}

export type Move = { okrug: string; district: string; street: string; house: string };

const houseNumber = (house: string) => Number.parseInt(house.replace(/\D+/g, " ").trim().split(" ")[0] ?? "", 10);

/** «улица грина|11»: a house as a key, to keep two incidents of one feed off the same house. */
export const houseKey = (street: string | null | undefined, house: string | null | undefined) => `${low(street).replace(/\s+/g, " ").trim()}|${low(house).replace(/\s+/g, "")}`;

/**
 * The house a card moves to: a street of the place's district (for a prefecture — of one of its districts), a house
 * near the one the tickets know there, or a small number that exists on almost any street; never a ticket's own house,
 * nor a house already in the place's feed (`avoid`, houseKey). Null when the gazetteer has no street there.
 */
export function moveTarget(t: Territory, seed: string, avoid: ReadonlySet<string> = new Set()): Move | null {
  const h = hash(seed);
  const districts = t.level === "district" ? [t.district!] : districtsOf(t.okrug);
  const withStreets = districts.filter((d) => streetsOf(d).length);
  if (!withStreets.length) return null;
  const district = withStreets[h % withStreets.length];
  const all = streetsOf(district);
  const tickets = (street: string) => ticketHouses(street).filter((x) => normalizeDistrict(x.district) === normalizeDistrict(district));
  // A through road only near a house the tickets place in this district.
  const calm = all.filter((p) => !THROUGH_ROAD.test(p.street) || tickets(p.street).length);
  const streets = calm.length ? calm : all;
  const p = streets[Math.floor(h / 7) % streets.length];
  const taken = new Set(ticketHouses(p.street).map((x) => low(x.house).replace(/\s+/g, "")));
  const near = tickets(p.street).map((x) => houseNumber(x.house)).find((n) => Number.isFinite(n) && n > 0);
  const step = 2 * (1 + (Math.floor(h / 13) % 4));
  let house = near ? (near > step && (h & 1) ? near - step : near + step) : 1 + (Math.floor(h / 13) % 24);
  for (let i = 0; i < 60 && (taken.has(String(house)) || avoid.has(houseKey(p.street, String(house)))); i++) house += 2;
  return { okrug: normalizeOkrug(p.okrug) ?? p.okrug!, district: p.district!, street: p.street, house: String(house) };
}

/**
 * The card on its new address: the house moves, the entrance, floor and flat stay; the object and the descriptive
 * address belonged to the old place and go.
 */
export function moveCard(spec: DdsCardSpec, to: Move): DdsCardSpec {
  const address: IncidentAddress = { ...spec.address };
  delete address.object;
  delete address.descriptive;
  return {
    ...spec,
    address: { ...address, country: address.country ?? "Россия", subject: "Москва", city: "Москва", okrug: to.okrug, district: to.district, street: to.street, house: to.house },
  };
}

/** Seed of a move: the same scenario comes to the same service on the same house, in every lesson and every poll. */
export const moveSeed = (scenarioId: string, serviceId: number) => `${scenarioId}|${serviceId}`;

/**
 * Where the card of a scenario goes for a place: `move` — the house it moves to (null: it stays where it is); `foreign`
 * — it stays off the place's territory (a task marked by hand that cannot move).
 */
export function moveFor(
  spec: DdsCardSpec,
  scenarioId: string,
  own: ServiceLike & { id: number },
  avoid: ReadonlySet<string> = new Set(),
): { move: Move | null; foreign: boolean } {
  const t = territoryOf(own);
  if (!t) return { move: null, foreign: false };
  const match = territoryMatch(placeOfAddress(spec.address), t);
  if (match === "in") return { move: null, foreign: false };
  const move = movable(spec) ? moveTarget(t, moveSeed(scenarioId, own.id), avoid) : null;
  return { move, foreign: !move && match === "out" };
}

/**
 * Plates of the card a place gets. Its own plate is always there (#684). A moved card: the district and prefecture
 * plates of the new address (`around` — the services of its okrug). A card left off the place's territory keeps its
 * plates and gets the place's own at the end: the right answer there is «Не принята» with whom it was passed to.
 * Otherwise a territorial place takes the plate of its level (platesForPlace).
 */
export function platesFor<T extends { id: number; shortName: string; district?: string | null }>(
  plates: T[],
  own: T,
  opts: { move: Move | null; foreign: boolean; around?: T[] },
): T[] {
  if (opts.foreign) return plates.some((p) => p.id === own.id) ? plates : [...plates, own];
  let list = plates;
  if (opts.move) {
    const around = opts.around ?? [];
    const key = normalizeDistrict(opts.move.district);
    const district = around.find((s) => territorialLevel(s.shortName) === "district" && normalizeDistrict(s.district) === key) ?? null;
    const prefecture = around.find((s) => territorialLevel(s.shortName) === "prefecture") ?? null;
    list = movedPlates(plates, { district, prefecture });
  }
  return platesForPlace(list, own);
}

/**
 * Plates of a moved card: the district and prefecture plates are those of the new address (a plate of the old place
 * whose counterpart is not in the service list goes); the others stay. A card without a territorial plate gets none
 * here — the place's own plate is added by platesForPlace.
 */
export function movedPlates<T extends { id: number; shortName: string }>(plates: T[], to: { district: T | null; prefecture: T | null }): T[] {
  const out: T[] = [];
  for (const p of plates) {
    const level = territorialLevel(p.shortName);
    const next = level === "district" ? to.district : level === "prefecture" ? to.prefecture : p;
    if (next && !out.some((x) => x.id === next.id)) out.push(next);
  }
  return out;
}

// ─── The applicant of a moved card ──────────────────────────────────────────

/** «Федеративный проспект, дом 12, корпус 2»: the address as the applicant says it. */
function spoken(a: IncidentAddress): { visible: string; hidden?: string } {
  const visible = [a.street, a.house && `дом ${a.house}`, a.building && `корпус ${a.building}`, a.structure && `строение ${a.structure}`].filter(Boolean).join(", ");
  const hidden = [a.entrance && `подъезд ${a.entrance}`, a.floor && `этаж ${a.floor}`, a.flat && `квартира ${a.flat}`, a.code && `код домофона ${a.code}`].filter(Boolean).join(", ");
  return { visible, ...(hidden ? { hidden } : {}) };
}

/**
 * The applicant of a card moved to another district answers the dispatcher's callback with the address on the card:
 * facts that name the old place are left out, and a story that names it is told as the card says.
 */
export function movedPersona(persona: CallerPersona, from: IncidentAddress, to: IncidentAddress, description: string | undefined): CallerPersona {
  const names = (text: string) => namesPlace(text, from) || LANDMARK.test(` ${low(text)}`) || /адрес/i.test(text);
  const said = spoken(to);
  return {
    ...persona,
    visibleAddress: said.visible,
    hiddenAddress: said.hidden,
    situation: namesPlace(persona.situation, from) && description ? description : persona.situation,
    facts: persona.facts.filter((f) => !names(f)),
  };
}

/** Whether a generated card was moved away from its scenario's address. */
export function wasMoved(stored: IncidentAddress | null | undefined, scenario: IncidentAddress): boolean {
  if (!stored) return false;
  const same = (a?: string, b?: string) => low(a).replace(/\s+/g, "") === low(b).replace(/\s+/g, "");
  return !same(stored.street, scenario.street) || !same(stored.house, scenario.house) || normalizeDistrict(stored.district) !== normalizeDistrict(scenario.district);
}

// ─── A card that is not the place's ─────────────────────────────────────────

/** «ДДС Мещанского района»-like words that show whom the card was passed to. */
function transferWords(place: ScenarioPlace): string[] {
  return [...stemsOf(place.district), ...(place.okrug && place.okrug !== "МО" ? [place.okrug] : []), ...(place.region ? stemsOf(place.region) : [])];
}

/**
 * The reference for a territorial place when the card's address is not on its territory: the memo's «Не принята»
 * with whose territory it is and to whom it was passed. Null when the card is the place's own or the address does not
 * say enough.
 */
export function foreignReference(service: ServiceLike, address: IncidentAddress | null | undefined): DdsReferenceEntry | null {
  const t = territoryOf(service);
  if (!t || !address) return null;
  const place = placeOfAddress(address);
  if (territoryMatch(place, t) !== "out") return null;
  const where = place.region ?? (place.district ? `${place.okrug ? `${place.okrug}, ` : ""}${place.district}` : (place.okrug ?? "другая территория"));
  const own = t.level === "prefecture" ? t.okrug : t.district;
  return {
    decision: "reject",
    why: `Адрес не на территории «${own}» (${where}): «Не принята» — чья это территория и кому передано (ДДС района или префектуры по адресу)`,
    transferTo: transferWords(place),
    chain: [],
    finalMust: [],
    crew: {},
    contacts: [],
    traps: [],
  };
}

/**
 * The reference a place's work on a card is judged by: the memo's refusal when the card is not on the territory of a
 * district or prefecture place, otherwise the scenario's entry for the place (referenceFor).
 */
export function cardReference(raw: unknown, service: ServiceLike & { id: number }, address: unknown): DdsReferenceEntry | null {
  const a = address && typeof address === "object" ? (address as IncidentAddress) : null;
  return foreignReference(service, a) ?? referenceFor(raw, service);
}
