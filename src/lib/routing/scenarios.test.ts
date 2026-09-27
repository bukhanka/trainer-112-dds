/** Consistency of data/scenarios.json with the classifier, the services and the routing engine. */
import type { ServiceStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { allowedNext, CLOSING, rulesFor } from "@/lib/dds/status";
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
  category: string;
  ddsReference: {
    services: {
      serviceId: number;
      service: string;
      decision: string;
      decisionComment?: string;
      chain: string[];
      brigadeReport: string;
      commentMustHave: string[];
      traps: string[];
    }[];
  } | null;
  approvedSections: string[];
  teacherNote: string | null;
};

const scenarios = readDataJson<Scenario[]>("scenarios.json");
const ref = loadJsonReference();
/** Tickets worked through by hand (scripts/deep-scenarios.ts): the only APPROVED ones. */
const DEEP = [
  // the first 15
  "Б1-1", "Б2-1", "Б4-1", "Б5-1", "Б7-1", "Б11-1", "Б13-1", "Б17-1", "Б20-1", "Б22-1", "Б26-1", "Б29-1", "Б30-3", "Б31-3", "Б32-2",
  // медицина
  "Б5-2", "Б11-2", "Б14-2", "Б17-2", "Б24-2",
];
/** Tickets whose exact address is printed in italics: the caller gives it only when asked (research/materials/bilety_all.txt). */
const ITALIC_ADDRESS = new Set(["Б1-1", "Б3-1", "Б4-1", "Б6-1", "Б7-1", "Б8-1", "Б9-1", "Б11-1", "Б12-1", "Б13-1", "Б14-1", "Б21-1", "Б25-1", "Б26-1"]);
/** Every lesson category a teacher picks must have approved scenarios. */
const MIN_APPROVED: Record<string, number> = { медицина: 4 };

const approved = scenarios.filter((s) => s.status === "APPROVED");
const serviceName = (id: number) => ref.services.find((r) => r.id === id)?.shortName ?? String(id);

describe("scenarios from the tickets", () => {
  it(`all 96 situations, ${DEEP.length} of them approved`, () => {
    expect(scenarios).toHaveLength(96);
    expect(approved.map((s) => s.ticketRef).sort()).toEqual([...DEEP].sort());
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

  it("approved: every section approved, the ДДС reference complete for each listed service", () => {
    for (const s of approved) {
      expect([...s.approvedSections].sort(), s.ticketRef).toEqual(["caller", "ddsCard", "ddsReference", "truth"]);
      expect(s.teacherNote, s.ticketRef).toBeNull();
      expect(s.caller.facts.length, s.ticketRef).toBeGreaterThanOrEqual(3);
      expect(s.truth.requiredQuestions.length, s.ticketRef).toBeGreaterThanOrEqual(2);
      const entries = s.ddsReference?.services ?? [];
      expect(entries.length, s.ticketRef).toBeGreaterThan(0);
      for (const d of entries) {
        const at = `${s.ticketRef} ${d.service}`;
        expect(serviceName(d.serviceId), at).toBe(d.service);
        expect(["ACCEPTED", "REJECTED"], at).toContain(d.decision);
        expect(d.commentMustHave.length, at).toBeGreaterThan(0);
        expect(Array.isArray(d.traps), at).toBe(true);
        expect(d.brigadeReport.trim().length, at).toBeGreaterThan(0);
        // A crew that goes out reports what it did: the report becomes the final comment.
        if (d.chain.some((x) => x === "STARTED" || x === "ARRIVED" || x === "WORKING")) expect(d.brigadeReport.length, at).toBeGreaterThan(20);
      }
    }
  });

  it("approved: the main service of the card has a reference entry", () => {
    for (const s of approved) {
      const main = s.truth.services.find((x) => x.isMain);
      if (!main) continue;
      expect(s.ddsReference!.services.map((d) => d.serviceId), `${s.ticketRef} ${serviceName(main.serviceId)}`).toContain(main.serviceId);
    }
  });

  it("approved: status chains go only where the dispatcher memo allows (status.ts) and end the card", () => {
    for (const s of approved) {
      for (const d of s.ddsReference!.services) {
        const at = `${s.ticketRef} ${d.service}`;
        const rules = rulesFor({ shortName: d.service });
        let current: ServiceStatus = "RECEIVED";
        for (const next of d.chain as ServiceStatus[]) {
          expect(allowedNext(current, rules), `${at}: ${current} → ${next}`).toContain(next);
          current = next;
        }
        if (d.decision === "REJECTED") expect(d.chain, at).toEqual(["REJECTED"]);
        else expect(CLOSING, at).toContain(current);
      }
    }
  });

  it("approved: the hidden address is exactly where the ticket prints it in italics", () => {
    for (const s of approved) {
      expect(Boolean(s.caller.hiddenAddress), s.ticketRef).toBe(ITALIC_ADDRESS.has(s.ticketRef));
    }
  });

  it("approved: each lesson category a teacher may pick has enough approved scenarios", () => {
    const count = new Map<string, number>();
    for (const s of approved) count.set(s.category, (count.get(s.category) ?? 0) + 1);
    for (const [category, min] of Object.entries(MIN_APPROVED)) {
      expect(count.get(category) ?? 0, category).toBeGreaterThanOrEqual(min);
    }
  });
});
