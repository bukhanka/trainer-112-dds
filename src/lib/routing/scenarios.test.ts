/** Consistency of data/scenarios.json with the classifier, the services and the routing engine. */
import type { ServiceStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { allowedNext, CLOSING, rulesFor } from "@/lib/dds/status";
import { referenceLeaves } from "@/lib/op112/evaluate";
import { selectServices } from "./engine";
import { loadJsonReference, readDataJson } from "./reference-json";

type Scenario = {
  ticketRef: string;
  source?: "instruction";
  status: "DRAFT" | "APPROVED";
  difficulty: number;
  caller: {
    fullName: string;
    visibleAddress: string;
    hiddenAddress?: string;
    situation: string;
    facts: string[];
    voice: string;
    line?: "silent" | "drops";
    dropAfter?: number;
    opening?: string;
  };
  truth: {
    emptyCall?: "noContact" | "dropped";
    repeatOf?: string;
    typeCodes: number[];
    acceptableTypeCodes: number[];
    flags: Record<string, boolean>;
    address: { district?: string; okrug?: string; subject?: string };
    inMoscow: boolean;
    services: { serviceId: number; isMain: boolean }[];
    requiredQuestions: string[];
  };
  category: string;
  ddsCard: unknown;
  ddsReference: {
    rules: string[];
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

const all = readDataJson<Scenario[]>("scenarios.json");
/** The customer's tickets; the tasks written from the operator's instruction are checked apart, below. */
const scenarios = all.filter((s) => s.source !== "instruction");
const tasks = all.filter((s) => s.source === "instruction");
const ref = loadJsonReference();
/** Tickets worked through by hand (scripts/deep-scenarios.ts): the only APPROVED ones. */
const DEEP = [
  // the first 15
  "Б1-1", "Б2-1", "Б4-1", "Б5-1", "Б7-1", "Б11-1", "Б13-1", "Б17-1", "Б20-1", "Б22-1", "Б26-1", "Б29-1", "Б30-3", "Б31-3", "Б32-2",
  // медицина
  "Б5-2", "Б11-2", "Б14-2", "Б17-2", "Б24-2",
  // человек в опасности
  "Б7-3", "Б8-3", "Б10-3", "Б18-3",
  // ДТП
  "Б27-2", "Б30-2", "Б31-2",
  // правопорядок
  "Б15-3", "Б25-1", "Б32-1",
  // ребёнок, смерть, обрушение
  "Б23-3", "Б26-3", "Б28-3",
];
/** Tickets whose exact address is printed in italics: the caller gives it only when asked (research/materials/bilety_all.txt). */
const ITALIC_ADDRESS = new Set(["Б1-1", "Б3-1", "Б4-1", "Б6-1", "Б7-1", "Б8-1", "Б9-1", "Б11-1", "Б12-1", "Б13-1", "Б14-1", "Б21-1", "Б25-1", "Б26-1"]);
/** Every lesson category a teacher picks must have approved scenarios. */
const MIN_APPROVED: Record<string, number> = {
  медицина: 4,
  "человек в опасности": 4,
  ДТП: 4,
  правопорядок: 4,
  пожар: 4,
  ребёнок: 1,
  смерть: 1,
  обрушение: 1,
  газ: 1,
  "угроза взрыва": 1,
};

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
    for (const s of all) {
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
        if (d.decision === "OPEN") expect(d.chain).toEqual([]);
        else expect(d.chain[0]).toBe(d.decision);
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
        expect(["ACCEPTED", "REJECTED", "OPEN"], at).toContain(d.decision);
        // An open decision has no must-haves: what to write depends on the answer the trainee picks.
        if (d.decision !== "OPEN") expect(d.commentMustHave.length, at).toBeGreaterThan(0);
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
        else if (d.decision === "ACCEPTED") expect(CLOSING, at).toContain(current);
      }
    }
  });

  it("approved: «Принята» in a reference always means work — no «Принята, к сведению» (memo pp. 25, 28–29)", () => {
    for (const s of approved) {
      for (const d of s.ddsReference!.services) {
        if (d.decision !== "ACCEPTED") continue;
        expect(d.chain.some((x) => x === "STARTED" || x === "ARRIVED" || x === "WORKING"), `${s.ticketRef} ${d.service}`).toBe(true);
      }
    }
  });

  it("approved: the reference names the ДДС norms of the customer's answer of 27.09 — open in 30 s, the first record in 3 min", () => {
    // The variants with an error in the card (data/scenarios-card-errors.json) go to the stand with the tickets.
    for (const s of [...approved, ...readDataJson<Scenario[]>("scenarios-card-errors.json")]) {
      const { rules, services } = s.ddsReference!;
      expect(rules[0], s.ticketRef).toMatch(/^Открыть карточку — не позже 30 секунд .+первая запись \(статус и текст\) — не позже 3 минут/);
      // Before the answer the norm was «Принята / Не принята» within 30 s.
      const old = [...rules, ...services.flatMap((d) => d.traps)].filter((t) => /Принята».{0,30}30 секунд|ответ за 30/.test(t));
      expect(old, s.ticketRef).toEqual([]);
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

  it("an accepted alternative leaf is judged by its own services: a death reported at night needs no Деп. ЖКХ", () => {
    const s = approved.find((x) => x.ticketRef === "Б26-3")!;
    const night = s.truth.acceptableTypeCodes.find((c) => !s.truth.typeCodes.includes(c))!;
    const leaves = referenceLeaves(s.truth, [night]);
    expect(leaves).toEqual({ codes: [night], alternative: true });
    const plates = selectServices(
      { typeCodes: leaves.codes, flags: s.truth.flags, district: s.truth.address.district, okrug: s.truth.address.okrug, region: null },
      ref,
    ).map((x) => serviceName(x.serviceId));
    expect(plates).toEqual(["Служба 102", "Служба 103"]);
    expect(s.truth.services.map((x) => serviceName(x.serviceId))).toContain("Деп. ЖКХ");
    // The main leaf keeps the scenario's own list.
    expect(referenceLeaves(s.truth, [s.truth.typeCodes[0], night]).alternative).toBe(false);
  });

  it("reviewed tickets: the railway prefecture refuses like the district, no loose alternatives, the police on site accept", () => {
    const byRef = (r: string) => approved.find((x) => x.ticketRef === r)!;
    for (const r of ["Б27-2", "Б28-3"]) expect(byRef(r).truth.acceptableTypeCodes, r).toEqual(byRef(r).truth.typeCodes);
    for (const r of ["Б1-1", "Б28-3"]) {
      const territorial = byRef(r).ddsReference!.services.filter((d) => d.service.startsWith("Поселение"));
      expect(territorial.map((d) => d.decision), r).toEqual(["REJECTED", "REJECTED"]);
    }
    const police = byRef("Б10-3").ddsReference!.services.find((d) => d.service === "Служба 102");
    expect(police?.decision).toBe("ACCEPTED");
    expect(police?.chain).toEqual(["ACCEPTED", "ARRIVED", "FINISHED"]);
  });
});

describe("tasks from the operator's instruction (scripts/instruction-scenarios.ts)", () => {
  const task = (ref: string) => tasks.find((s) => s.ticketRef === ref)!;

  it("approved tasks for the 112 place only: no ДДС card, no ДДС reference", () => {
    expect(tasks.map((s) => s.ticketRef)).toEqual(["НВ-1", "НВ-2", "НВ-3", "ПВ-1"]);
    for (const s of tasks) {
      expect(s.status, s.ticketRef).toBe("APPROVED");
      expect(s.approvedSections, s.ticketRef).toEqual(["caller", "truth"]);
      expect(s.ddsCard, s.ticketRef).toBeNull();
      expect(s.ddsReference, s.ticketRef).toBeNull();
    }
    for (const ref of ["НВ-1", "НВ-2", "НВ-3"]) expect(task(ref).caller.line, ref).toBeDefined();
  });

  it("a repeat call keeps the reference card of the ticket it repeats and names it", () => {
    const repeat = task("ПВ-1");
    const original = scenarios.find((s) => s.ticketRef === "Б4-1")!;
    expect(repeat.truth.repeatOf).toBe("Б4-1");
    expect(repeat.truth.typeCodes).toEqual(original.truth.typeCodes);
    expect(repeat.truth.address).toEqual(original.truth.address);
    expect(repeat.truth.services).toEqual(original.truth.services);
    // A second witness gives the place at once and does not know the first caller.
    expect(repeat.caller.hiddenAddress).toBeUndefined();
    expect(repeat.caller.fullName).not.toBe(original.caller.fullName);
  });

  it("a silent line and a break on the first words are closed as empty cards, without services", () => {
    expect(task("НВ-1").caller.line).toBe("silent");
    expect(task("НВ-1").truth.emptyCall).toBe("noContact");
    expect(task("НВ-2").caller.line).toBe("drops");
    expect(task("НВ-2").caller.dropAfter).toBe(1);
    expect(task("НВ-2").truth.emptyCall).toBe("dropped");
    for (const ref of ["НВ-1", "НВ-2"]) {
      expect(task(ref).truth.services, ref).toEqual([]);
      expect(task(ref).truth.typeCodes, ref).toEqual([]);
    }
  });

  it("a call that breaks after the address is a real incident: a card with services, the phone-only one included", () => {
    const s = task("НВ-3");
    expect(s.truth.emptyCall).toBeUndefined();
    expect(s.truth.typeCodes.length).toBeGreaterThan(0);
    expect(s.truth.address.district).toBe("Щукино");
    const plates = s.truth.services.map((x) => serviceName(x.serviceId));
    expect(plates).toContain("Служба 101");
    expect(plates).toContain("Деп. ЖКХ");
  });
});
