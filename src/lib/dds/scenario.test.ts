import { describe, expect, it } from "vitest";
import { botPlan, dueSteps } from "./bots";
import { crewChain, crewExpected, ddsCardOf, platesForPlace, reachesPlace, referenceFor, territorialLevel } from "./scenario";

const service = { id: 191, shortName: "Поселение Вороновское" };

describe("referenceFor", () => {
  it("reads the default entry and normalises Russian status names", () => {
    const ref = referenceFor(
      { default: { decision: "Принята", chain: ["Начало реагирования", "Прибытие", "Работы завершены"], finalMust: ["газ"] } },
      service,
    );
    expect(ref?.decision).toBe("accept");
    expect(ref?.chain).toEqual(["STARTED", "ARRIVED", "FINISHED"]);
    expect(ref?.finalMust).toEqual(["газ"]);
  });

  it("prefers the entry of the service by id or short name", () => {
    const raw = { default: { decision: "accept" }, services: { "191": { decision: "reject", transferTo: ["Практика"] } } };
    expect(referenceFor(raw, service)?.decision).toBe("reject");
    const byName = { services: { "Поселение Вороновское": { decision: "не принята" } } };
    expect(referenceFor(byName, service)?.decision).toBe("reject");
  });

  it("accepts an array of entries and a bare entry", () => {
    expect(referenceFor([{ serviceId: 5, decision: "reject" }, { decision: "accept" }], service)?.decision).toBe("accept");
    expect(referenceFor([{ serviceId: 191, decision: "reject" }], service)?.decision).toBe("reject");
    expect(referenceFor({ decision: true }, service)?.decision).toBe("accept");
  });

  it("returns null when there is nothing usable", () => {
    expect(referenceFor(null, service)).toBeNull();
    expect(referenceFor({ note: "x" }, service)).toBeNull();
  });

  it("gives a default crew chain and none for a rejection", () => {
    expect(crewChain(null)).toEqual(["STARTED", "ARRIVED", "WORKING", "FINISHED"]);
    expect(crewChain(referenceFor({ decision: "reject" }, service))).toEqual([]);
  });
});

describe("ddsCardOf", () => {
  it("falls back to truth and the caller persona", () => {
    const card = ddsCardOf({
      id: "s",
      title: "Запах газа",
      category: "Газ",
      caller: { fullName: "Соколова Вера Ивановна", role: "очевидец", phone: "+7 916", situation: "Пахнет газом", facts: [] },
      truth: { typeCodes: [13010700], services: [5, { id: 191 }], flags: { gas: true } },
    });
    expect(card.services).toEqual([5, 191]);
    expect(card.typeCodes).toEqual([13010700]);
    expect(card.caller.fullName).toBe("Соколова Вера Ивановна");
    expect(card.caller.status).toBe("очевидец");
    expect(card.description).toBe("Пахнет газом");
    expect(card.flags.gas).toBe(true);
  });
});

describe("bots", () => {
  const plate = { id: "p1", serviceId: 1, shortName: "Служба 101", delivery: "VIS" as const };

  it("keeps grey phone-only plates still", () => {
    expect(botPlan({ ...plate, delivery: "PHONE" })).toEqual([]);
  });

  it("moves forward in order and answers within the norm", () => {
    const plan = botPlan(plate);
    expect(plan[0].status).toBe("RECEIVED");
    expect(plan[1].status).toBe("ACCEPTED");
    expect(plan[1].afterSec).toBeLessThanOrEqual(30);
    expect(plan[plan.length - 1].status).toBe("FINISHED");
    for (let i = 1; i < plan.length; i++) expect(plan[i].afterSec).toBeGreaterThan(plan[i - 1].afterSec);
  });

  it("returns only the due steps after the current status", () => {
    const plan = botPlan(plate);
    expect(dueSteps(plan, "ADDED", 0)).toEqual([]);
    expect(dueSteps(plan, "ADDED", 10_000).length).toBe(plan.length);
    expect(dueSteps(plan, "ACCEPTED", 10_000)[0].status).toBe("STARTED");
    expect(dueSteps(plan, "REJECTED", 10_000)).toEqual([]);
  });
});

// ─── The format of data/scenarios.json ───────────────────────────────────────

const ticket = {
  id: "t",
  title: "Б30-3. В частном доме запах газа от трубы на вводе в дом",
  category: "газ",
  caller: { fullName: "Соколова Вера Ивановна", role: "очевидец", phone: "+7 (916) 320-12-83", situation: "Пахнет газом", facts: [] },
  truth: {
    kind: "104",
    typeCodes: [13020100],
    finalType: "Запах бытового газа в частном доме",
    address: { country: "Россия", subject: "Москва", city: "Москва", okrug: "ТиНАО", district: "Вороновское", street: "пос. ЛМС, мкр Солнечный", house: "20" },
    services: [
      { serviceId: 5, shortName: "Служба 104", isMain: true },
      { serviceId: 191, shortName: "Поселение Вороновское", isMain: false },
      { serviceId: 181, shortName: "Поселение ТиНАО", isMain: false },
    ],
  },
  ddsCard: {
    classLabel: "Запах бытового газа в частном доме",
    tagsLine: "Запах газа в помещении · Дом частный",
    flags: { victims: false, refusedAmbulance: false, blocked: true },
    address: "Москва, пос. ЛМС, мкр Солнечный, д. 20, частный дом",
    descriptive: null,
    description: "Запах газа от трубы на вводе в дом",
    caller: { fullName: "Соколова Вера Ивановна", status: "очевидец", aon: "+7 (916) 320-12-83", provided: "+7 (916) 320-12-83" },
    services: ["Служба 104", "Поселение Вороновское", "Поселение ТиНАО"],
  },
  ddsReference: {
    rules: ["«Принята» или «Не принята» — не позже 30 секунд"],
    services: [
      {
        serviceId: 191,
        service: "Поселение Вороновское",
        decision: "ACCEPTED",
        chain: ["ACCEPTED", "STARTED", "ARRIVED", "WORKING", "FINISHED"],
        brigadeReport: "Утечка на фланцевом соединении устранена, жители предупреждены",
        commentMustHave: ["что сделано: перекрыт кран, устранена утечка", "жители предупреждены"],
        traps: ["Не отказываться только потому, что уже реагирует другая служба"],
      },
      { serviceId: 60, service: "Поселение Дорогомилово", decision: "REJECTED", decisionComment: "Территория МЖД, передано дежурному по станции", chain: ["REJECTED"], brigadeReport: "—", commentMustHave: ["кому передано"], traps: [] },
      { serviceId: 181, service: "Поселение ТиНАО", decision: "ACCEPTED", chain: ["ACCEPTED", "FINISHED"], brigadeReport: "—", commentMustHave: ["принято к сведению"], traps: [] },
    ],
  },
};

describe("data/scenarios.json format", () => {
  it("builds the ДДС card from classLabel, tagsLine and truth", () => {
    const card = ddsCardOf(ticket);
    expect(card.cardType).toBe("104");
    expect(card.finalTypes).toEqual(["Запах бытового газа в частном доме"]);
    expect(card.tags.map((t) => t.value)).toEqual(["Запах газа в помещении", "Дом частный"]);
    expect(card.services).toEqual([5, 191, 181]);
    expect(card.address.district).toBe("Вороновское");
    expect(card.flags.noAccess).toBe(true);
    expect(card.caller.aon).toBe("+7 (916) 320-12-83");
  });

  it("falls back to plate names when truth has no ids", () => {
    const card = ddsCardOf({ ...ticket, truth: { kind: "104" } });
    expect(card.services).toEqual([]);
    expect(card.serviceNames).toEqual(["Служба 104", "Поселение Вороновское", "Поселение ТиНАО"]);
  });

  it("reads the reference entry of the service", () => {
    const ref = referenceFor(ticket.ddsReference, { id: 191, shortName: "Поселение Вороновское" });
    expect(ref?.decision).toBe("accept");
    expect(ref?.chain).toEqual(["STARTED", "ARRIVED", "WORKING", "FINISHED"]);
    expect(ref?.crew.result).toContain("устранена");
    expect(ref?.finalMust).toHaveLength(2);
    const reject = referenceFor(ticket.ddsReference, { id: 60, shortName: "Поселение Дорогомилово" });
    expect(reject?.decision).toBe("reject");
    expect(reject?.why).toContain("передано");
    expect(reject?.crew.result).toBeUndefined();
  });

  it("gives a territorial place the entry of the same level when it is not on the card", () => {
    const district = referenceFor(ticket.ddsReference, { id: 70, shortName: "Поселение Щукино" });
    expect(district?.decision).toBe("accept"); // the first district-level entry: Вороновское
    const prefecture = referenceFor(ticket.ddsReference, { id: 46, shortName: "Поселение САО" });
    expect(prefecture?.chain).toEqual(["FINISHED"]);
    expect(crewExpected(prefecture)).toBe(false);
    expect(crewExpected(district)).toBe(true);
    expect(referenceFor(ticket.ddsReference, { id: 21, shortName: "Мослифт" })).toBeNull();
  });

  it("puts the place's plate in place of the territorial plate of its level", () => {
    const plates = [
      { id: 1, shortName: "Служба 101" },
      { id: 60, shortName: "Поселение Дорогомилово" },
      { id: 156, shortName: "Поселение ЗАО" },
    ];
    expect(platesForPlace(plates, { id: 191, shortName: "Поселение Вороновское" }).map((p) => p.id)).toEqual([1, 191, 156]);
    expect(platesForPlace(plates, { id: 181, shortName: "Поселение ТиНАО" }).map((p) => p.id)).toEqual([1, 60, 181]);
    expect(platesForPlace(plates, { id: 21, shortName: "Мослифт" }).map((p) => p.id)).toEqual([1, 60, 156, 21]);
    expect(platesForPlace(plates, { id: 1, shortName: "Служба 101" })).toBe(plates);
    expect(territorialLevel("Поселение ТиНАО")).toBe("prefecture");
    // A district place is reached by a card with any district ДДС plate, not by a card for 103 alone.
    const own = { shortName: "Поселение Вороновское" };
    expect(reachesPlace(["Служба 101", "Поселение Щукино", "Поселение СЗАО"], own)).toBe(true);
    expect(reachesPlace(["Служба 103"], own)).toBe(false);
    expect(reachesPlace(["Служба 103"], { shortName: "Служба 103" })).toBe(true);
    expect(reachesPlace(["Служба 101", "Поселение СЗАО"], { shortName: "Поселение ТиНАО" })).toBe(true);
    expect(territorialLevel("Служба 101")).toBeNull();
  });
});
