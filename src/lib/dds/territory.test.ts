/** A card that comes to a district or prefecture ДДС is on its territory (territory.ts), checked on the delivered data. */
import { describe, expect, it } from "vitest";
import { readDataJson } from "@/lib/routing/reference-json";
import { ddsCardOf, personaOf, referenceFor, type ScenarioLike } from "./scenario";
import {
  cardReference,
  foreignReference,
  hasStreets,
  houseKey,
  LOW_RISE_FLOORS,
  lowRise,
  movable,
  moveCard,
  movedPersona,
  moveFor,
  moveTarget,
  namesPlace,
  placeOfAddress,
  platesFor,
  scenarioStoreys,
  storeysOf,
  territoryMatch,
  territoryOf,
  wasMoved,
} from "./territory";

type Service = { id: number; shortName: string; fullName: string | null; kind: string; okrug: string | null; district: string | null };
type Ticket = ScenarioLike & { ticketRef: string };

const services = readDataJson<Service[]>("services.json");
const tickets = [...readDataJson<Omit<Ticket, "id">[]>("scenarios.json"), ...readDataJson<Omit<Ticket, "id">[]>("scenarios-card-errors.json")]
  .filter((t) => t.ddsCard)
  .map((t) => ({ ...t, id: t.ticketRef }));
const ticket = (ref: string) => tickets.find((t) => t.ticketRef === ref)!;
const service = (name: string) => services.find((s) => s.shortName === name)!;
/** District and prefecture ДДС of the list; Zelenograd districts without streets in the gazetteer and district councils aside. */
const territorial = services.filter((s) => territoryOf(s));

const horoshevo = service("Поселение Хорошево-Мневники");
const voronovo = service("Поселение Вороновское");
const vao = service("Поселение ВАО");

describe("territory of a place", () => {
  it("reads the district or okrug of a territorial ДДС, and nothing for a city service", () => {
    expect(territoryOf(horoshevo)).toEqual({ level: "district", okrug: "СЗАО", district: "Хорошево-Мневники" });
    expect(territoryOf(vao)).toEqual({ level: "prefecture", okrug: "ВАО", district: null });
    expect(territoryOf(service("Служба 101"))).toBeNull();
    // Without the okrug in the row, the gazetteer knows it.
    expect(territoryOf({ shortName: "Поселение Вороновское" })).toEqual({ level: "district", okrug: "ТиНАО", district: "Вороновское" });
    expect(territorial.length).toBeGreaterThan(150);
  });

  it("tells whether an address is on it; «Хорошево» and «Хорошёво» are one district", () => {
    const t = territoryOf(horoshevo)!;
    expect(territoryMatch(placeOfAddress(ddsCardOf(ticket("Б2-1")).address), t)).toBe("in");
    expect(territoryMatch(placeOfAddress(ddsCardOf(ticket("Б17-1")).address), t)).toBe("out");
    expect(territoryMatch(placeOfAddress({ subject: "Московская область", city: "Королёв" }), t)).toBe("out");
    expect(territoryMatch(placeOfAddress({ city: "Москва" }), t)).toBe("unknown");
    expect(territoryMatch(placeOfAddress(ddsCardOf(ticket("Б3-2")).address), territoryOf(vao)!)).toBe("in");
  });
});

describe("a card moved onto the place's territory", () => {
  it("moves an ordinary house, never a station, a park, a lake, a private house or the ring road", () => {
    for (const ref of ["Б17-1", "Б2-1", "Б5-1", "Б22-1", "Б31-3", "Б5-1-ош"]) expect(movable(ddsCardOf(ticket(ref))), ref).toBe(true);
    // Ярославский вокзал, Кусковский лесопарк, озеро Круглое, «частный дом», МЖД, МКАД, Московская область, no house.
    for (const ref of ["Б28-3", "Б13-1", "Б8-3", "Б30-3", "Б1-1", "Б6-1", "Б3-1", "Б30-2", "Б9-1"]) expect(movable(ddsCardOf(ticket(ref))), ref).toBe(false);
  });

  it("has a street for every district, settlement and prefecture of the list but three Zelenograd districts", { timeout: 30_000 }, () => {
    const without = territorial.filter((s) => !moveTarget(territoryOf(s)!, "probe")).map((s) => s.shortName);
    expect(without.sort()).toEqual(["Поселение Матушкино", "Поселение Силино", "Поселение Старое Крюково"]);
  });

  it("lands on the place's territory, the same house for the same scenario and service, never on a ticket's house", { timeout: 30_000 }, () => {
    const spec = ddsCardOf(ticket("Б17-1"));
    const ticketHouses = new Set(tickets.map((x) => ddsCardOf(x).address).map((a) => `${a.street}|${a.house}`));
    for (const s of territorial) {
      const t = territoryOf(s)!;
      const to = moveTarget(t, `Б17-1|${s.id}`);
      if (!to) continue;
      expect(moveTarget(t, `Б17-1|${s.id}`)).toEqual(to);
      const moved = moveCard(spec, to);
      expect(territoryMatch(placeOfAddress(moved.address), t), `${s.shortName}: ${JSON.stringify(to)}`).toBe("in");
      expect(ticketHouses.has(`${to.street}|${to.house}`)).toBe(false);
    }
  });

  it("keeps two incidents of one feed off the same house", () => {
    const t = territoryOf(voronovo)!;
    const seen = new Set<string>();
    for (const x of tickets.filter((x) => movable(ddsCardOf(x)) && scenarioStoreys(x) <= LOW_RISE_FLOORS)) {
      const to = moveTarget(t, `${x.id}|${voronovo.id}`, seen, scenarioStoreys(x))!;
      const key = houseKey(to.street, to.house);
      expect(seen.has(key), `${x.ticketRef}: ${key}`).toBe(false);
      seen.add(key);
    }
    expect(seen.size).toBeGreaterThan(25);
  });

  it("reads how high the house is from the card and the applicant's words", () => {
    expect(scenarioStoreys(ticket("Б4-1"))).toBe(14); // «Дом 14 этажей», the fire on the 13th floor
    expect(scenarioStoreys(ticket("Б5-1"))).toBe(17);
    expect(scenarioStoreys(ticket("Б2-1"))).toBe(17); // «в доме 17 этажей», «семнадцатиэтажный»
    expect(scenarioStoreys(ticket("Б31-3"))).toBe(2);
    expect(scenarioStoreys(ticket("Б17-1"))).toBe(0);
    expect(storeysOf({ address: {}, description: "Дом семнадцатиэтажный, горит на тринадцатом этаже" })).toBe(17);
    expect(storeysOf({ address: { floor: "3" }, description: "Лежит в подъезде на 1 этаже" })).toBe(3);
    expect(storeysOf({ address: {}, description: "Задымление на минус первом этаже торгового центра" })).toBe(0);
    expect(lowRise("село Вороново")).toBe(true);
    expect(lowRise("посёлок ЛМС, микрорайон Солнечный")).toBe(true);
    expect(lowRise("улица Народного Ополчения")).toBe(false);
    expect(lowRise("город Троицк, Октябрьский проспект")).toBe(false);
  });

  it("never puts a high house into a village: a settlement of villages does not get it, a city district does", { timeout: 30_000 }, () => {
    const high = ["Б2-1", "Б4-1", "Б5-1", "Б2-1-ош", "Б4-1-ош", "Б5-1-ош"];
    for (const ref of high) {
      const t = ticket(ref);
      expect(scenarioStoreys(t), ref).toBeGreaterThan(LOW_RISE_FLOORS);
      expect(moveFor(ddsCardOf(t), t.id, voronovo, new Set(), scenarioStoreys(t)), ref).toEqual({ move: null, foreign: true });
      const { move } = moveFor(ddsCardOf(t), t.id, service("Поселение Мещанский"), new Set(), scenarioStoreys(t));
      expect(move && !lowRise(move.street), `${ref} → Мещанский: ${move?.street}`).toBe(true);
    }
    expect(hasStreets(territoryOf(voronovo)!, 14)).toBe(false);
    expect(hasStreets(territoryOf(voronovo)!, 2)).toBe(true);
    // A low house still moves there, floor and flat kept.
    const b31 = ticket("Б31-3");
    const low = moveFor(ddsCardOf(b31), b31.id, voronovo, new Set(), scenarioStoreys(b31)).move!;
    expect(moveCard(ddsCardOf(b31), low).address).toMatchObject({ district: "Вороновское", floor: "2", flat: "5" });
    // Whatever the place: a house higher than a village's lands on a city street.
    for (const x of tickets.filter((x) => movable(ddsCardOf(x)) && scenarioStoreys(x) > LOW_RISE_FLOORS)) {
      for (const s of territorial) {
        const { move } = moveFor(ddsCardOf(x), x.id, s, new Set(), scenarioStoreys(x));
        if (move) expect(lowRise(move.street), `${x.ticketRef} → ${s.shortName}: ${move.street}`).toBe(false);
      }
    }
  });

  it("keeps the entrance and the code, drops the object and the descriptive address of the old place", () => {
    const { move } = moveFor(ddsCardOf(ticket("Б4-1")), "Б4-1", horoshevo);
    const moved = moveCard(ddsCardOf(ticket("Б4-1")), move!);
    expect(moved.address).toMatchObject({ okrug: "СЗАО", district: "Хорошёво-Мнёвники", floor: "13", city: "Москва" });
    expect(moved.address.street).not.toBe("ул. Грина");
    expect(moved.address.descriptive).toBeUndefined();
    const b17 = moveCard(ddsCardOf(ticket("Б17-1")), moveFor(ddsCardOf(ticket("Б17-1")), "Б17-1", horoshevo).move!);
    expect(b17.address).toMatchObject({ structure: "2", entrance: "1", code: "2215", district: "Хорошёво-Мнёвники" });
  });

  it("leaves no trace of the old place in the card, the reference or the applicant's words", { timeout: 30_000 }, () => {
    for (const t of tickets) {
      const spec = ddsCardOf(t);
      if (!movable(spec)) continue;
      for (const place of [horoshevo, voronovo, vao, service("Поселение Северное Бутово")]) {
        const { move } = moveFor(spec, t.id, place);
        if (!move) continue; // already on the territory
        const moved = moveCard(spec, move);
        const old = spec.address;
        expect(namesPlace(moved.description ?? "", old), `${t.ticketRef} → ${place.shortName}: описание`).toBe(false);
        expect(wasMoved(moved.address, old)).toBe(true);
        const ref = referenceFor(t.ddsReference, place);
        for (const text of [ref?.why ?? "", ref?.crew.result ?? "", ref?.crew.work ?? "", ...(ref?.finalMust ?? []), ref?.cardError?.report ?? ""]) {
          expect(namesPlace(text, old), `${t.ticketRef} → ${place.shortName}: эталон «${text}»`).toBe(false);
        }
        const persona = personaOf(t);
        if (!persona) continue;
        const said = movedPersona(persona, old, moved.address, moved.description);
        for (const text of [said.visibleAddress, said.hiddenAddress ?? "", said.situation, ...said.facts]) {
          expect(namesPlace(text, old), `${t.ticketRef} → ${place.shortName}: заявитель «${text}»`).toBe(false);
        }
        expect(said.visibleAddress).toContain(move.street);
      }
    }
  });

  it("gives the district and prefecture plates of the new address, keeps the others", () => {
    const plate = (name: string) => {
      const s = service(name);
      return { id: s.id, shortName: s.shortName, district: s.district };
    };
    const card = ["Служба 101", "Деп. ЖКХ", "Поселение Мещанский", "Поселение ЦАО"].map(plate);
    const around = services.filter((s) => s.okrug === "СЗАО").map((s) => ({ id: s.id, shortName: s.shortName, district: s.district }));
    const { move } = moveFor(ddsCardOf(ticket("Б17-1")), "Б17-1", horoshevo);
    const plates = platesFor(card, plate("Поселение Хорошево-Мневники"), { move, foreign: false, around });
    expect(plates.map((p) => p.shortName)).toEqual(["Служба 101", "Деп. ЖКХ", "Поселение Хорошево-Мневники", "Поселение СЗАО"]);
    // A prefecture place: the district of the new address, its own plate in place of the prefecture.
    const toVao = moveFor(ddsCardOf(ticket("Б17-1")), "Б17-1", vao).move!;
    const vaoAround = services.filter((s) => s.okrug === "ВАО").map((s) => ({ id: s.id, shortName: s.shortName, district: s.district }));
    const vaoPlates = platesFor(card, plate("Поселение ВАО"), { move: toVao, foreign: false, around: vaoAround });
    expect(vaoPlates.map((p) => p.shortName).slice(0, 2)).toEqual(["Служба 101", "Деп. ЖКХ"]);
    expect(vaoPlates.map((p) => p.shortName)).toContain("Поселение ВАО");
    expect(vaoPlates.map((p) => p.shortName)).not.toContain("Поселение Мещанский");
    expect(vaoPlates.map((p) => p.shortName)).not.toContain("Поселение ЦАО");
    // A card that stays off the territory keeps its plates, the place's own is added.
    expect(platesFor(card, plate("Поселение Хорошево-Мневники"), { move: null, foreign: true }).map((p) => p.shortName)).toEqual([
      "Служба 101",
      "Деп. ЖКХ",
      "Поселение Мещанский",
      "Поселение ЦАО",
      "Поселение Хорошево-Мневники",
    ]);
  });

  it("does not move a card for a city service or one already on the territory", () => {
    expect(moveFor(ddsCardOf(ticket("Б17-1")), "Б17-1", service("Служба 101"))).toEqual({ move: null, foreign: false });
    expect(moveFor(ddsCardOf(ticket("Б2-1")), "Б2-1", horoshevo)).toEqual({ move: null, foreign: false });
    expect(moveFor(ddsCardOf(ticket("Б28-3")), "Б28-3", horoshevo)).toEqual({ move: null, foreign: true });
  });
});

describe("the applicant of a moved card", () => {
  it("names the new address, tells the story as the card says when the old one names the street", () => {
    const t = ticket("Б4-1");
    const spec = ddsCardOf(t);
    const moved = moveCard(spec, moveFor(spec, t.id, horoshevo).move!);
    const said = movedPersona(personaOf(t)!, spec.address, moved.address, moved.description);
    expect(said.visibleAddress).toMatch(/^\S.*, дом \d+/);
    expect(said.situation).toBe(spec.description);
    expect(said.hiddenAddress).toBe("этаж 13");
    const b30 = ticket("Б17-1");
    const kept = movedPersona(personaOf(b30)!, ddsCardOf(b30).address, moved.address, "x");
    expect(kept.situation).toBe(personaOf(b30)!.situation); // the story names no street: it stays in the caller's words
  });
});

describe("a card that is not the place's", () => {
  it("is judged as the memo says: «Не принята», whose territory it is and to whom it was passed", () => {
    const foreign = foreignReference(horoshevo, ddsCardOf(ticket("Б17-1")).address)!;
    expect(foreign.decision).toBe("reject");
    expect(foreign.why).toContain("Хорошево-Мневники");
    expect(foreign.why).toContain("Мещанский");
    expect(foreign.transferTo).toContain("мещанск");
    expect(foreign.chain).toEqual([]);
    // Its own card, a city service, an address without a district: the scenario's reference.
    expect(foreignReference(horoshevo, ddsCardOf(ticket("Б2-1")).address)).toBeNull();
    expect(foreignReference(service("Служба 101"), ddsCardOf(ticket("Б17-1")).address)).toBeNull();
    expect(foreignReference(horoshevo, { city: "Москва" })).toBeNull();
    expect(cardReference(ticket("Б2-1").ddsReference, horoshevo, ddsCardOf(ticket("Б2-1")).address)?.decision).toBe("accept");
    expect(cardReference(ticket("Б17-1").ddsReference, horoshevo, ddsCardOf(ticket("Б17-1")).address)?.decision).toBe("reject");
    // Moved onto the territory, the card is the place's again: the reference of its level applies.
    const spec = ddsCardOf(ticket("Б17-1"));
    const moved = moveCard(spec, moveFor(spec, "Б17-1", horoshevo).move!);
    expect(cardReference(ticket("Б17-1").ddsReference, horoshevo, moved.address)?.decision).toBe("accept");
  });
});
