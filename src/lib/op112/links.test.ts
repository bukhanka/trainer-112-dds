import { describe, expect, it } from "vitest";
import { findMatches, linkCheck, phonesOf, samePlace, searchCards } from "./links";

const first = {
  id: "c1",
  caller: { aon: "+7 (916) 126-34-71", provided: "+7 (916) 126-34-71" },
  address: { street: "ул. Грина", house: "11", district: "Северное Бутово", okrug: "ЮЗАО" },
};
const other = {
  id: "c2",
  caller: { aon: "+7 (925) 000-11-22" },
  address: { street: "улица Рогова", house: "12" },
};

describe("«Совпадение»: the same phone or the same place", () => {
  it("compares the last ten digits of every phone of the caller", () => {
    expect(phonesOf({ aon: "+7 (916) 126-34-71", provided: "8 916 126 34 71", onSite: "12" })).toEqual(["9161263471", "9161263471"]);
  });

  it("the same street is the same place when the houses agree or one is not known yet", () => {
    expect(samePlace({ street: "улица Грина", house: "11" }, first.address)).toBe(true);
    expect(samePlace({ street: "Грина ул.", house: "" }, first.address)).toBe(true);
    expect(samePlace({ street: "улица Грина", house: "15" }, first.address)).toBe(false);
    expect(samePlace({ street: "", house: "11" }, first.address)).toBe(false);
    expect(samePlace({ street: "улица Рогова", house: "11" }, first.address)).toBe(false);
  });

  it("finds a card by phone (the АОН block) and by place (the address block), never the card itself", () => {
    const byPhone = findMatches({ id: "new", caller: { aon: "+79161263471" }, address: {} }, [first, other]);
    expect(byPhone.byPhone.map((c) => c.id)).toEqual(["c1"]);
    expect(byPhone.byAddress).toEqual([]);
    const byPlace = findMatches({ id: "new", caller: { aon: "+7 (903) 771-25-40" }, address: { street: "улица Грина", house: "11" } }, [first, other]);
    expect(byPlace.byPhone).toEqual([]);
    expect(byPlace.byAddress.map((c) => c.id)).toEqual(["c1"]);
    expect(findMatches({ id: "c1", caller: first.caller, address: first.address }, [first]).byAddress).toEqual([]);
  });

  it("the link window searches by number, street or type, every word", () => {
    const cards = [
      { id: "c1", number: 36815072, place: "ул. Грина, д. 11 (ЮЗАО, Северное Бутово)", kinds: "Происшествие 101" },
      { id: "c2", number: 36815080, place: "улица Рогова, д. 12 (СЗАО, Щукино)", kinds: "ДТП" },
    ];
    expect(searchCards(cards, "грина").map((c) => c.id)).toEqual(["c1"]);
    expect(searchCards(cards, "5080").map((c) => c.id)).toEqual(["c2"]);
    expect(searchCards(cards, "рогова дтп").map((c) => c.id)).toEqual(["c2"]);
    expect(searchCards(cards, "")).toHaveLength(2);
  });
});

describe("the review of links", () => {
  const repeatCards = [{ id: "c1", number: 36815072, place: "ул. Грина, д. 11 (ЮЗАО, Северное Бутово)" }];

  it("a repeat call linked to the first call's card: no duplicate", () => {
    const c = linkCheck({ repeatOf: "Б4-1", link: { id: "c1", number: 36815072 }, repeatCards })!;
    expect(c).toMatchObject({ code: "op112.link.repeat", ok: true });
    expect(c.evidence).toContain("№ 36815072");
  });

  it("a repeat call left unlinked, or linked elsewhere, is a mistake with the right card named", () => {
    const loose = linkCheck({ repeatOf: "Б4-1", link: null, repeatCards })!;
    expect(loose.ok).toBe(false);
    expect(loose.evidence).toContain("дубль");
    expect(loose.expected).toContain("№ 36815072");
    expect(linkCheck({ repeatOf: "Б4-1", link: { id: "x", number: 1 }, repeatCards })!.ok).toBe(false);
    expect(linkCheck({ repeatOf: "Б4-1", link: null, repeatCards: [] })!.ok).toBeNull();
  });

  it("a new incident needs no link: none — no check, a link — a mistake", () => {
    expect(linkCheck({ link: null, repeatCards: [] })).toBeNull();
    expect(linkCheck({ link: { id: "c1", number: 36815072 }, repeatCards: [] })).toMatchObject({ code: "op112.link.extra", ok: false });
  });
});
