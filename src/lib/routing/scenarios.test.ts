/** Consistency of data/scenarios.json with the classifier, the services and the routing engine. */
import { describe, expect, it } from "vitest";
import { selectServices } from "./engine";
import { loadJsonReference, readDataJson } from "./reference-json";

type Scenario = {
  ticketRef: string;
  status: "DRAFT" | "APPROVED";
  difficulty: number;
  caller: { fullName: string; visibleAddress: string; hiddenAddress?: string; situation: string; facts: string[]; voice: string };
  truth: {
    typeCodes: number[];
    acceptableTypeCodes: number[];
    flags: Record<string, boolean>;
    address: { district?: string; okrug?: string; subject?: string };
    inMoscow: boolean;
    services: { serviceId: number; isMain: boolean }[];
    requiredQuestions: string[];
  };
  ddsReference: { services: { serviceId: number; decision: string; decisionComment?: string; chain: string[] }[] } | null;
  teacherNote: string | null;
};

const scenarios = readDataJson<Scenario[]>("scenarios.json");
const ref = loadJsonReference();
const DEEP = ["Б1-1", "Б2-1", "Б4-1", "Б5-1", "Б7-1", "Б11-1", "Б13-1", "Б17-1", "Б20-1", "Б22-1", "Б26-1", "Б29-1", "Б30-3", "Б31-3", "Б32-2"];

describe("scenarios from the tickets", () => {
  it("all 96 situations, 15 of them approved", () => {
    expect(scenarios).toHaveLength(96);
    const approved = scenarios.filter((s) => s.status === "APPROVED").map((s) => s.ticketRef);
    expect(approved.sort()).toEqual([...DEEP].sort());
    for (const s of scenarios.filter((x) => x.status === "DRAFT")) {
      expect(s.teacherNote).toBe("черновик, ждёт проверки преподавателем");
    }
  });

  it("types exist in the classifier and the reference card services match the engine", () => {
    for (const s of scenarios) {
      for (const code of [...s.truth.typeCodes, ...s.truth.acceptableTypeCodes]) expect(ref.types.has(code), `${s.ticketRef} ${code}`).toBe(true);
      const again = selectServices(
        {
          typeCodes: s.truth.typeCodes,
          flags: s.truth.flags,
          district: s.truth.address.district,
          okrug: s.truth.address.okrug,
          region: s.truth.inMoscow ? null : s.truth.address.subject,
        },
        ref,
      ).map((x) => x.serviceId);
      expect(s.truth.services.map((x) => x.serviceId), s.ticketRef).toEqual(again);
    }
  });

  it("caller persona is complete; hidden address only where the ticket has it", () => {
    for (const s of scenarios) {
      expect(s.caller.fullName.length).toBeGreaterThan(2);
      expect(s.caller.visibleAddress.length).toBeGreaterThan(5);
      expect(s.caller.facts.length).toBeGreaterThan(0);
      expect(["male", "female"]).toContain(s.caller.voice);
      expect(s.difficulty).toBeGreaterThanOrEqual(1);
      expect(s.difficulty).toBeLessThanOrEqual(10);
    }
    const hidden = scenarios.filter((s) => s.caller.hiddenAddress).map((s) => s.ticketRef);
    expect(hidden).toContain("Б1-1");
    expect(hidden).toContain("Б4-1");
    expect(hidden).not.toContain("Б30-3");
  });

  it("ДДС reference: services are on the card, «Не принята» always explains whom it was passed to", () => {
    for (const s of scenarios.filter((x) => x.status === "APPROVED")) {
      expect(s.ddsReference, s.ticketRef).not.toBeNull();
      const onCard = new Set(s.truth.services.map((x) => x.serviceId));
      for (const d of s.ddsReference!.services) {
        expect(onCard.has(d.serviceId), `${s.ticketRef} ${d.serviceId}`).toBe(true);
        if (d.decision === "REJECTED") expect(d.decisionComment ?? "").toMatch(/передано/i);
        expect(d.chain[0]).toBe(d.decision);
      }
    }
  });

  it("ticket 30-3 is the Вороновское duty service case from the screenshots", () => {
    const s = scenarios.find((x) => x.ticketRef === "Б30-3")!;
    expect(s.truth.address.district).toBe("Вороновское");
    const plates = s.truth.services.map((x) => ref.services.find((r) => r.id === x.serviceId)!.shortName);
    expect(plates).toContain("Поселение Вороновское");
    expect(plates).toContain("Поселение ТиНАО");
    expect(s.truth.requiredQuestions.join(" ")).toMatch(/магистральный или баллон/);
  });

  it("addresses outside Moscow never get a territorial duty service", () => {
    for (const s of scenarios.filter((x) => !x.truth.inMoscow)) {
      const plates = s.truth.services.map((x) => ref.services.find((r) => r.id === x.serviceId)!.shortName);
      expect(plates.some((p) => p.startsWith("Поселение") || p.startsWith("Упр.")), s.ticketRef).toBe(false);
    }
  });
});
