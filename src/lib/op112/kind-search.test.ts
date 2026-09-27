import { describe, expect, it } from "vitest";
import { readDataJson } from "@/lib/routing/reference-json";
import { searchKinds, searchKindsByLeaves, type LeafType } from "./catalog";

type Classifier = { groups: { id: number; name: string }[]; types: LeafType[] };
const classifier = readDataJson<Classifier>("classifier.json");
const names = (q: string) => searchKinds(q).map((k) => k.name);

describe("«Что случилось?»: search with synonyms, as op112.md promises", () => {
  it("everyday words find the card: судороги, приступ, медицина → 103; мусоропровод → 101", () => {
    for (const q of ["судороги", "приступ", "медицина", "Судорогами"]) expect(names(q), q).toContain("103");
    expect(names("мусоропровод")).toContain("101");
    expect(names("пожар")[0]).toBe("101");
    expect(names("дтп")).toContain("ДТП");
  });

  it("the whole classifier leads to the kind of a leaf, with the leaf as the hint", () => {
    const hits = (q: string) => searchKindsByLeaves(q, classifier.types, classifier.groups);
    expect(hits("судороги")[0]).toEqual({ name: "103", match: "Судороги" });
    expect(hits("мусоропровод")[0].name).toBe("101");
    // Many leaves of 103 hold the word in a sign; a lift «требуется медицинская помощь» comes after.
    expect(hits("медицинской")[0].name).toBe("103");
    expect(hits("медицинской").map((h) => h.name)).toContain("Аварии и происшествия в городском хозяйстве");
    expect(hits("такого слова нет")).toEqual([]);
  });

  it("leaves hidden from the operator are not searched", () => {
    const hidden: LeafType = { code: 1, groupId: 22, subgroup: null, sign1: null, sign2: null, sign3: null, finalType: "Секретный лист", hiddenFromOperator: true };
    expect(searchKindsByLeaves("секретный", [hidden], classifier.groups)).toEqual([]);
  });
});
