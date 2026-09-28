import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { learningMetaSchema } from "../src/lib/followup/metadata";

type Ticket = {
  ticketRef: string;
  status: string;
  source?: string;
  difficulty: number;
  approvedSections: string[];
  caller: { visibleAddress?: string; hiddenAddress?: string };
  truth: { address?: { street?: string; house?: string }; requiredQuestions?: string[] };
  ddsCard?: { services?: string[] } | null;
  ddsReference?: {
    services?: {
      serviceId: number;
      service: string;
      decision: string;
      chain: string[];
      brigadeReport?: string;
      commentMustHave?: string[];
    }[];
  } | null;
  learningMeta?: unknown;
};

const tickets = JSON.parse(readFileSync(path.join(__dirname, "../data/scenarios.json"), "utf8")) as Ticket[];
const curated = tickets.flatMap((ticket) =>
  ticket.learningMeta === undefined ? [] : [{ ticket, meta: learningMetaSchema.parse(ticket.learningMeta) }],
);

const byRole = (role: "OP112" | "DDS") => curated.filter(({ meta }) => meta.role === role);

function expectPracticeAndReservedControls(rows: typeof curated) {
  expect(rows).toHaveLength(3);
  expect(rows.filter(({ meta }) => meta.purpose === "practice")).toHaveLength(1);
  expect(rows.filter(({ meta }) => meta.purpose === "control")).toHaveLength(2);
  expect(new Set(rows.map(({ meta }) => meta.equivalenceKey)).size).toBe(1);
  expect(new Set(rows.map(({ meta }) => meta.caseKey)).size).toBe(rows.length);
}

describe("curated learning cases from customer tickets", () => {
  it("uses only completely approved tickets and stable, unique case identities", () => {
    expect(curated).toHaveLength(6);
    expect(new Set(curated.map(({ meta }) => meta.caseKey)).size).toBe(curated.length);
    for (const { ticket, meta } of curated) {
      expect(ticket.status).toBe("APPROVED");
      expect(ticket.source ?? "ticket").toBe("ticket");
      expect(ticket.approvedSections).toEqual(expect.arrayContaining(["caller", "truth", "ddsCard", "ddsReference"]));
      expect(meta.caseKey).toBe(`ticket:${ticket.ticketRef}`);
      expect(meta.skillKeys).toEqual([meta.role === "OP112" ? "op112.location" : "dds.report_record"]);
    }
  });

  it("pairs 112 cases where the caller can reveal a missing house after a question", () => {
    const rows = byRole("OP112");
    expectPracticeAndReservedControls(rows);
    for (const { ticket } of rows) {
      const house = ticket.truth.address?.house;
      expect(ticket.difficulty).toBeGreaterThanOrEqual(5);
      expect(ticket.difficulty).toBeLessThanOrEqual(7);
      expect(ticket.truth.address?.street).toBeTruthy();
      expect(house).toBeTruthy();
      expect(ticket.caller.hiddenAddress).toContain(`дом ${house}`);
      expect(ticket.caller.visibleAddress).not.toMatch(new RegExp(`(?:дом|д\\.)\\s*${house}(?!\\d)`, "i"));
      expect(ticket.truth.requiredQuestions?.some((question) => question.includes("Уточнить адрес"))).toBe(true);
    }
  });

  it("pairs different pediatric incidents for the same responding DDS service and report task", () => {
    const rows = byRole("DDS");
    expectPracticeAndReservedControls(rows);
    expect(Math.max(...rows.map(({ ticket }) => ticket.difficulty)) - Math.min(...rows.map(({ ticket }) => ticket.difficulty))).toBeLessThanOrEqual(1);
    for (const { ticket } of rows) {
      expect(ticket.ddsCard?.services).toContain("Служба 103");
      const reference = ticket.ddsReference?.services?.find((service) => service.serviceId === 4 && service.service === "Служба 103");
      expect(reference?.decision).toBe("ACCEPTED");
      expect(reference?.chain).toEqual(["ACCEPTED", "STARTED", "ARRIVED", "WORKING", "FINISHED"]);
      expect(reference?.brigadeReport?.length).toBeGreaterThan(40);
      expect(reference?.commentMustHave?.length).toBeGreaterThanOrEqual(3);
    }
  });
});
