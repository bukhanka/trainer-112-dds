/** Other services on a card move by themselves; how their work ends follows the scenario (bots.ts, dds-flow botFacts). */
import { describe, expect, it } from "vitest";
import { botFacts } from "@/lib/flow/dds-flow";
import { readDataJson } from "@/lib/routing/reference-json";
import { botPlan, dueSteps } from "./bots";
import { ddsCardOf, type ScenarioLike } from "./scenario";
import { moveCard, moveFor, scenarioStoreys } from "./territory";

type Ticket = ScenarioLike & { ticketRef: string };
const tickets = [...readDataJson<Omit<Ticket, "id">[]>("scenarios.json"), ...readDataJson<Omit<Ticket, "id">[]>("scenarios-card-errors.json")].map((t) => ({ ...t, id: t.ticketRef }));
const ticket = (ref: string) => tickets.find((t) => t.ticketRef === ref)!;
const fire = { id: 1, shortName: "Служба 101" };
const plate = (extra: Partial<Parameters<typeof botPlan>[0]> = {}) => ({ id: "plate-1", serviceId: 1, shortName: "Служба 101", delivery: "VIS" as const, ...extra });
const finish = (p: Parameters<typeof botPlan>[0]) => botPlan(p).find((s) => s.status === "FINISHED")?.comment;

describe("how another service's work ends", () => {
  it("never «пострадавших нет» when someone is hurt on site", () => {
    expect(finish(plate())).toMatch(/пострадавших нет/);
    expect(finish(plate({ victims: true }))).not.toMatch(/пострадавших нет/);
    expect(finish(plate({ victims: true }))).toMatch(/пострадавш/);
  });

  it("closes with the service's own report of the scenario", () => {
    const card = ticket("Б4-1-ош");
    const facts = botFacts({ flags: ddsCardOf(card).flags, address: ddsCardOf(card).address, scenario: card }, fire);
    // The card says «пострадавших нет», the crews find a man with burns: the 101 report says so.
    expect(facts.victims).toBe(true);
    expect(facts.report).toMatch(/пострадавший — мужчина с ожогами рук/);
    expect(finish(plate(facts))).toBe(facts.report);
    // A service without an entry of its own keeps the general lines, still without «пострадавших нет».
    const other = botFacts({ flags: {}, address: ddsCardOf(card).address, scenario: card }, { id: 7, shortName: "ЦОДД" });
    expect(other).toEqual({ report: null, victims: true });
    // A scenario with nobody hurt.
    expect(botFacts({ flags: ddsCardOf(ticket("Б2-1")).flags, address: ddsCardOf(ticket("Б2-1")).address, scenario: ticket("Б2-1") }, fire).victims).toBe(false);
  });

  it("keeps the report of a moved card when it does not name the old place", () => {
    const card = ticket("Б17-1");
    const spec = ddsCardOf(card);
    const moved = moveCard(spec, moveFor(spec, card.id, { id: 87, shortName: "Поселение Хорошево-Мневники", okrug: "СЗАО", district: "Хорошево-Мневники" }, new Set(), scenarioStoreys(card)).move!);
    expect(botFacts({ flags: moved.flags, address: moved.address, scenario: card }, fire).report).toMatch(/Ложное срабатывание/);
  });

  it("is the same plan on every poll, due step by step", () => {
    const p = plate({ report: "Пожар ликвидирован", victims: false });
    expect(botPlan(p)).toEqual(botPlan(p));
    expect(dueSteps(botPlan(p), "ADDED", 1)).toEqual([]);
    expect(dueSteps(botPlan(p), "ADDED", 10_000).at(-1)).toMatchObject({ status: "FINISHED", comment: "Пожар ликвидирован" });
  });
});
