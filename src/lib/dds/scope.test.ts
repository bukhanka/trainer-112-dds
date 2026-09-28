import { describe, expect, it } from "vitest";
import { seatFeedWhere, takesCardsFrom112 } from "./scope";

// What comes to the feed of a ДДС place, by the lesson's source of cards (Lesson.settings.cardSource):
// «generated» — only the cards the system deals to the place; «students» and «mixed» — also the cards saved at the
// 112 places of the lesson that carry the place's service.
type Row = Record<string, unknown>;
type Where = Record<string, unknown>;

/** Just enough of Prisma's `where` for the feed: equality, null, { not }, OR, NOT and { some } on a list relation. */
function matches(row: Row, where: Where): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === "OR") return (cond as Where[]).some((w) => matches(row, w));
    if (key === "NOT") return !matches(row, cond as Where);
    const value = row[key];
    if (cond === null) return value == null;
    if (typeof cond === "object") {
      const c = cond as Where;
      if ("not" in c) return value !== c.not;
      if ("some" in c) return ((value as Row[] | undefined) ?? []).some((v) => matches(v, c.some as Where));
      return value != null && matches(value as Row, c);
    }
    return value === cond;
  });
}

const SEAT = { id: "dds1", lessonId: "l1", serviceId: 191 };
const plate = (serviceId: number, addedFor: string | null = null) => ({ serviceId, events: [{ status: "ADDED", seatId: addedFor }] });
const CARDS: Row[] = [
  // Dealt to the place by the card flow.
  { id: "dealt", lessonId: "l1", ddsSeatId: "dds1", source: "generated", status: "registered", services: [plate(191), plate(1)] },
  // Made by another tool (the demo lessons): the place is named in the «Добавлена» event of its plate.
  { id: "demo", lessonId: "l1", ddsSeatId: null, source: "generated", status: "registered", services: [plate(191, "dds1")] },
  // Saved at a 112 place of the lesson with the place's service.
  { id: "from112", lessonId: "l1", ddsSeatId: null, source: "op112", status: "registered", services: [plate(1), plate(191)] },
  { id: "worked112", lessonId: "l1", ddsSeatId: null, source: "op112", status: "worked", services: [plate(191)] },
  // Never: a 112 draft, a 112 card without the service, a card of another lesson, a card dealt to another place.
  { id: "draft112", lessonId: "l1", ddsSeatId: null, source: "op112", status: "draft", services: [plate(191)] },
  { id: "other112", lessonId: "l1", ddsSeatId: null, source: "op112", status: "registered", services: [plate(1)] },
  { id: "otherLesson", lessonId: "l2", ddsSeatId: null, source: "op112", status: "registered", services: [plate(191)] },
  { id: "otherPlace", lessonId: "l1", ddsSeatId: "dds2", source: "generated", status: "registered", services: [plate(191)] },
];
const feed = (cardSource: "generated" | "students" | "mixed", seat: typeof SEAT | (Omit<typeof SEAT, "serviceId"> & { serviceId: null }) = SEAT) =>
  CARDS.filter((c) => matches(c, seatFeedWhere(seat, { cardSource }))).map((c) => c.id);

describe("feed of a ДДС place by the source of cards", () => {
  it("«generated»: only the cards dealt to the place — cards of the 112 places stay at 112", () => {
    expect(takesCardsFrom112({ cardSource: "generated" })).toBe(false);
    expect(feed("generated")).toEqual(["dealt", "demo"]);
  });

  it("«students» and «mixed»: the saved 112 cards with the place's service come too, as before", () => {
    for (const cardSource of ["students", "mixed"] as const) {
      expect(takesCardsFrom112({ cardSource })).toBe(true);
      expect(feed(cardSource), cardSource).toEqual(["dealt", "demo", "from112", "worked112"]);
    }
  });

  it("a place without a service sees only the cards dealt to it", () => {
    for (const cardSource of ["generated", "students", "mixed"] as const) {
      expect(feed(cardSource, { ...SEAT, serviceId: null }), cardSource).toEqual(["dealt"]);
    }
  });
});
