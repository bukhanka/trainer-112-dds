import { describe, expect, it } from "vitest";
import { selectServices } from "@/lib/routing/engine";
import { loadJsonReference, readDataJson } from "@/lib/routing/reference-json";
import { choiceOptions, panelFor, pruneAnswers, searchKinds, signsTree, visibleRows, type LeafType } from "./catalog";
import { resolveCard, tagsToAnswers } from "./card";
import { compareStreets, suggestAddress } from "./gazetteer";
import { mergeManual } from "./routing";

const FLAME = "Открытое пламя / Дым";
const ref = loadJsonReference();
const leaves = readDataJson<{ types: LeafType[] }>("classifier.json").types;
const names = (list: { serviceId: number }[]) => list.map((s) => ref.services.find((x) => x.id === s.serviceId)?.shortName);

function plates(cards: string[], answers: Record<string, Record<string, string[]>>, top = {}, district?: string) {
  const trees = Object.fromEntries(cards.map((c) => [c, panelFor(c, leaves)]));
  const r = resolveCard(cards, answers, top, trees);
  return { r, services: selectServices({ typeCodes: r.typeCodes, flags: r.flags, district }, ref) };
}

describe("«что случилось» and panels", () => {
  it("finds 101 by «пожар» and ДТП by «авария»", () => {
    expect(searchKinds("пожар")[0].name).toBe("101");
    expect(searchKinds("авария").map((k) => k.name)).toContain("ДТП");
  });

  it("street fire with rubbish: «пожар: мусор», 101 (main), ЦОДД, ОАТИ", () => {
    const { r, services } = plates(["101"], { "101": { where: ["Улица"], signStreet: [FLAME], streetObject: ["Мусор"] } });
    expect(r.typeCodes).toEqual([1010101]);
    expect(names(services)).toEqual(["Служба 101", "ЦОДД", "ОАТИ"]);
    expect(services[0].isMain).toBe(true);
  });

  it("threat adds ЦЭМП and the district adds the territorial ДДС", () => {
    const { services } = plates(
      ["101"],
      { "101": { where: ["Улица"], signStreet: [FLAME], streetObject: ["Мусор"], threat: ["Да"] } },
      {},
      "Дорогомилово",
    );
    expect(names(services)).toEqual(expect.arrayContaining(["ЦЭМП", "Поселение Дорогомилово", "Поселение ЗАО"]));
  });

  it("top buttons become routing flags", () => {
    const { r } = plates(["101"], { "101": { where: ["Улица"], signStreet: [FLAME], streetObject: ["Мусор"] } }, { victims: true });
    expect(r.flags.victims).toBe(true);
  });

  it("a group without a hand-made panel gets the classifier signs G → H → I", () => {
    const tree = signsTree({ name: "ДТП", groupId: 2 }, leaves);
    const first = choiceOptions(tree, tree.rows[0], {});
    expect(first.length).toBeGreaterThan(1);
    const a = { sign1: [first[0]] };
    expect(visibleRows(tree, a).map((r) => r.id)).toContain("sign2");
    expect(tree.rows.some((r) => r.flag === "threat")).toBe(true);
  });

  it("drops answers of a branch the operator left", () => {
    const tree = panelFor("101");
    const pruned = pruneAnswers(tree, { where: ["Дом"], signStreet: [FLAME], streetObject: ["Мусор"] });
    expect(pruned).toEqual({ where: ["Дом"] });
  });

  it("stores tags the ДДС can print and the workstation can restore", () => {
    const answers = { "101": { where: ["Дом"], signHouse: [FLAME], houseKind: ["Дом многоквартирный"], floors: ["14"], houseInner: ["Балкон"] } };
    const r = resolveCard(["101"], answers, {});
    expect(r.tags.find((t) => t.rowId === "floors")).toMatchObject({ value: "Этажность здания: 14", text: "14" });
    expect(tagsToAnswers(r.tags)).toEqual({ cards: ["101"], answers });
    expect(r.typeCodes).toEqual([1050201]);
  });

  it("keeps a chosen kind without answers", () => {
    const r = resolveCard(["Консультация"], {}, {});
    expect(r.typeCodes).toEqual([23030000]);
    expect(tagsToAnswers(r.tags).cards).toEqual(["Консультация"]);
  });

  it("keeps automatic plates and adds manual ones after them", () => {
    const catalog = ref.services.map((s) => ({ id: s.id, shortName: s.shortName, kind: "", orderIdx: s.orderIdx }));
    const all = mergeManual([{ serviceId: 1, isMain: true, auto: true }], [113, 1, 99999], catalog);
    expect(all.map((s) => s.serviceId)).toEqual([1, 113]);
    expect(all[1].auto).toBe(false);
  });
});

describe("address suggestions", () => {
  it("offers a ticket address with its district", () => {
    const [s] = suggestAddress("грина 11");
    expect(s.address).toMatchObject({ street: "ул. Грина", house: "11", district: "Северное Бутово", okrug: "ЮЗАО" });
  });

  it("offers both streets of a look-alike pair", () => {
    const streets = suggestAddress("дубн").map((s) => s.address.street);
    expect(streets.some((x) => /Дубнинская/.test(x ?? ""))).toBe(true);
    expect(suggestAddress("дубин").some((s) => /Дубининская/.test(s.address.street ?? ""))).toBe(true);
  });

  it("tells another kind of street and typos from the same street written differently", () => {
    expect(compareStreets("ул. Грина", "улица Грина")).toBe("same");
    expect(compareStreets("Коломенская улица", "Коломенская набережная")).toBe("lookalike");
    expect(compareStreets("Грин", "улица Грина")).toBe("typo");
    expect(compareStreets("Киевская улица", "МЖД Киевская 1 км")).toBe("other");
    expect(compareStreets("Тверская улица", "улица Грина")).toBe("other");
  });
});

describe("address suggestions keep the answer hidden", () => {
  it("never suggests the house of a ticket the operator did not type", () => {
    for (const q of ["грина", "киевская", "дмитровское"]) {
      for (const s of suggestAddress(q)) {
        expect(s.address.house).toBeUndefined();
        expect(s.address.structure).toBeUndefined();
      }
    }
    expect(suggestAddress("электронный рай")).toEqual([]);
  });
});

describe("tag line for the ДДС", () => {
  it("names the row of a yes/no answer", () => {
    const answers = { "101": { where: ["Улица"], signStreet: [FLAME], streetObject: ["Мусор"], threat: ["Нет"] } };
    const r = resolveCard(["101"], answers, {});
    expect(r.tags.find((t) => t.rowId === "threat")).toMatchObject({ value: "Угроза людям: Нет", text: "Нет" });
    expect(tagsToAnswers(r.tags).answers["101"].threat).toEqual(["Нет"]);
  });
});
