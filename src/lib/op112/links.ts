/**
 * Links between cards («Совпадение», «создать связь»). The instruction: «При заведении карточки система может
 * сообщить, что карточка с таким же номером заявителя или местом происшествия уже была добавлена в систему
 * недавно. При этом появляется кнопка «Совпадение»»; «После нажатия на кнопку «Привязать» текущая карточка станет
 * связанной с выбранной карточкой»; the card linked to becomes the main one, the card linked from — subordinate.
 * Two chains join through their main cards, so a link always goes to a main card.
 *
 * Here: the pure matching rules and the review check; the database side is in links-db.ts.
 */
import type { CriterionResult } from "@/lib/scoring/score";
import type { IncidentAddress, IncidentCaller } from "@/lib/incident/types";
import { compareStreets, normHouse } from "./gazetteer";

/** A saved card of the lesson as the link windows show it (the scenario stays hidden). */
export type CardRef = {
  id: string;
  number: number;
  savedAt: string | null;
  /** «ул. Грина, д. 11 (ЮЗАО, Северное Бутово)» */
  place: string;
  kinds: string;
  operator: string;
  status: string;
  /** the main card it is linked to, if it is a subordinate one */
  mainNumber: number | null;
  /**
   * In «Совпадение» by number: whether the card may be linked from here. Only a card of the same place — the same
   * number alone is not the same incident («otherPlace»); while the address is empty there is nothing to compare («noPlace»).
   */
  link?: "ok" | "otherPlace" | "noPlace";
};

export type MatchSource = { caller: IncidentCaller; address: IncidentAddress };
export type MatchCandidate = MatchSource & { id: string };

/** Last ten digits of each phone of the caller: АОН, предоставленный, на место. */
export function phonesOf(caller: IncidentCaller): string[] {
  return [caller.aon, caller.provided, caller.onSite]
    .map((p) => (p ?? "").replace(/\D/g, "").slice(-10))
    .filter((d) => d.length === 10);
}

/** The same place: the same street, and the same house when both cards have one. */
export function samePlace(a: IncidentAddress, b: IncidentAddress): boolean {
  if (!a.street?.trim() || !b.street?.trim()) return false;
  if (compareStreets(a.street, b.street) !== "same") return false;
  const ha = normHouse(a.house);
  const hb = normHouse(b.house);
  return !ha || !hb || ha === hb;
}

/**
 * Cards that match by a phone number (the button in the АОН block) and by the place (the button in the address block).
 * A card of the same situation typed at another place of the lesson is a parallel copy of this very exercise, not an
 * earlier call: it is not offered (`situation`, scenarios/pairs.ts).
 */
export function findMatches<T extends MatchCandidate & { situation?: string | null }>(
  card: MatchSource & { id?: string; situation?: string | null },
  candidates: T[],
): { byPhone: T[]; byAddress: T[] } {
  const mine = new Set(phonesOf(card.caller));
  const others = candidates.filter((c) => c.id !== card.id && !(card.situation && c.situation === card.situation));
  return {
    byPhone: mine.size ? others.filter((c) => phonesOf(c.caller).some((p) => mine.has(p))) : [],
    byAddress: others.filter((c) => samePlace(card.address, c.address)),
  };
}

/** Whether a card found by the number may be linked: only at the same place — the number alone is another incident. */
export function phoneMatchLink(card: MatchSource, candidate: MatchSource): "ok" | "otherPlace" | "noPlace" {
  if (!card.address.street?.trim()) return "noPlace";
  return samePlace(card.address, candidate.address) ? "ok" : "otherPlace";
}

/** Words of a search in the «создать связь» window: every word must be in the card's number, address or type. */
export function searchCards<T extends Pick<CardRef, "number" | "place" | "kinds">>(cards: T[], query: string): T[] {
  const words = query
    .toLowerCase()
    .replace(/ё/g, "е")
    .split(/[\s,.]+/)
    .filter(Boolean);
  if (!words.length) return cards;
  return cards.filter((c) => {
    const hay = `${c.number} ${c.place} ${c.kinds}`.toLowerCase().replace(/ё/g, "е");
    return words.every((w) => hay.includes(w));
  });
}

export const LINK_CODES = ["op112.link.repeat", "op112.link.extra"] as const;

export type LinkFacts = {
  /** the scenario is a repeat call of this ticket */
  repeatOf?: string;
  /** the main card the saved card is linked to */
  link: { id: string; number: number } | null;
  /** saved cards of the lesson made from the ticket the call repeats */
  repeatCards: { id: string; number: number; place: string }[];
};

/**
 * The review check of links. A repeat call must be linked to the card of the first call (a second, unlinked card
 * is a duplicate the services get as a new incident); a call about a new incident must not be linked to another.
 */
export function linkCheck(f: LinkFacts): CriterionResult | null {
  if (f.repeatOf) {
    const first = f.repeatCards[0];
    if (!first) {
      return { code: "op112.link.repeat", group: "services", title: "Повторный вызов привязан к карточке первого вызова", ok: null, source: "rule", evidence: "Карточки первого вызова в занятии нет" };
    }
    const linked = f.link ? f.repeatCards.find((c) => c.id === f.link!.id) : undefined;
    const ok = Boolean(linked);
    return {
      code: "op112.link.repeat",
      group: "services",
      title: "Повторный вызов привязан к карточке первого вызова",
      ok,
      source: "rule",
      evidence: ok
        ? `Привязана к карточке № ${linked!.number} (${linked!.place}) — дубля нет`
        : f.link
          ? `Привязана к № ${f.link.number}, а первый вызов об этом происшествии — в карточке № ${first.number} (${first.place})`
          : `Не привязана: в занятии уже есть карточка № ${first.number} (${first.place}) об этом происшествии — службы получили её дубль`,
      expected: ok ? undefined : `«Совпадение» (по адресу или номеру) или «создать связь» (Alt+W) → «привязать» к карточке № ${first.number}`,
    };
  }
  if (f.link) {
    return {
      code: "op112.link.extra",
      group: "services",
      title: "Нет лишней связи с другой карточкой",
      ok: false,
      source: "rule",
      evidence: `Карточка привязана к № ${f.link.number}, но это вызов о новом происшествии`,
      expected: "Отвязать: связь нужна только для повторного вызова об уже заведённом происшествии",
    };
  }
  return null;
}
