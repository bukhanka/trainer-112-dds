/**
 * The demo lessons seat every ДДС place at a district ДДС whose territory its cards are on (jury check of 29.09: a
 * settlement must not get another district's card, nor a fire on the 13th floor moved into a village).
 */
import { describe, expect, it } from "vitest";
import { DEFAULT_DDS, DEMO_PLANS } from "../prisma/demo-plan";
import { hasCardError, type ScenarioLike } from "@/lib/dds/scenario";
import { territoryOf } from "@/lib/dds/territory";
import { onTerritory } from "@/lib/flow/dds-flow";
import { readDataJson } from "@/lib/routing/reference-json";

type Service = { id: number; shortName: string; okrug: string | null; district: string | null };
type Ticket = ScenarioLike & { ticketRef: string; status?: string };

const services = readDataJson<Service[]>("services.json");
const tickets = [...readDataJson<Omit<Ticket, "id">[]>("scenarios.json"), ...readDataJson<Omit<Ticket, "id">[]>("scenarios-card-errors.json")].map((t) => ({ ...t, id: t.ticketRef }));

describe("demo lessons", () => {
  it("deal every ДДС place only cards that land on its territory", () => {
    for (const [lesson, plan] of Object.entries(DEMO_PLANS)) {
      for (const seat of plan.filter((s) => s.role === "DDS")) {
        const service = services.find((s) => s.shortName === (seat.service ?? DEFAULT_DDS));
        expect(service, `${lesson}: ${seat.service}`).toBeTruthy();
        const t = territoryOf(service!)!;
        expect(t, `${lesson}: ${seat.service} — районная ДДС`).toBeTruthy();
        for (const ref of seat.tasks) {
          const ticket = tickets.find((x) => x.ticketRef === ref);
          expect(ticket, ref).toBeTruthy();
          expect(onTerritory(ticket!, t), `${lesson}: ${ref} → ${service!.shortName}`).not.toBe("no");
        }
      }
    }
  });

  it("never give a 112 place a card-error variant, never deal a situation to both roles of a mixed lesson", () => {
    for (const [lesson, plan] of Object.entries(DEMO_PLANS)) {
      const at112 = new Set(plan.filter((s) => s.role === "OP112").flatMap((s) => s.tasks));
      for (const ref of at112) expect(hasCardError(tickets.find((x) => x.ticketRef === ref)?.ddsReference), `${lesson}: ${ref}`).toBe(false);
      if (!lesson.includes("h4") && !lesson.endsWith("-2")) continue; // the mixed lessons
      for (const seat of plan.filter((s) => s.role === "DDS")) {
        for (const ref of seat.tasks) expect(at112.has(ref.replace(/-ош$/, "")), `${lesson}: ${ref}`).toBe(false);
      }
    }
  });
});
