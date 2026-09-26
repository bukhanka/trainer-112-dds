import { describe, expect, it } from "vitest";
import { botPlan, dueSteps } from "./bots";
import { crewChain, ddsCardOf, referenceFor } from "./scenario";

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
