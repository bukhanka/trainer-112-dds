import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildPool, caseKeys, misfit, unsuitable, type PoolScenario, type PoolService } from "./pool";

/** The customer's tickets as the seed loads them (the ticket reference stands for the id). */
type Row = Omit<PoolScenario, "id" | "ticketRef"> & { ticketRef: string };
const files = ["scenarios.json", "scenarios-card-errors.json"].map((f) => JSON.parse(readFileSync(path.join(__dirname, "../../../data", f), "utf8")) as Row[]);
const all: PoolScenario[] = files.flat().map((r) => ({ ...r, id: r.ticketRef, ddsCard: r.ddsCard ?? null, ddsReference: r.ddsReference ?? null, learningMeta: r.learningMeta ?? null }));
const approved = all.filter((s) => s.status === "APPROVED");
const byRef = (ref: string) => all.find((s) => s.ticketRef === ref)!;
const refs = (list: { id: string }[]) => list.map((o) => o.id);

const district: PoolService = { id: 87, shortName: "Поселение Хорошево-Мневники", okrug: "СЗАО", district: "Хорошево-Мневники" };
const voronovo: PoolService = { id: 191, shortName: "Поселение Вороновское", okrug: "ТиНАО", district: "Вороновское" };
const prefecture: PoolService = { id: 46, shortName: "Поселение САО", okrug: "САО", district: null };
const ambulance: PoolService = { id: 4, shortName: "Служба 103" };
const none = new Set<string>();

describe("112 practice and control for «уточнить и записать место»", () => {
  const pool = buildPool("op112.location", approved, { source: byRef("Б4-1"), service: null, seen: none });

  it("never gives the call the error was made on, nor its «-ош» variant", () => {
    expect(refs(pool.practice)).not.toContain("Б4-1");
    expect(refs(pool.control)).not.toContain("Б4-1");
    expect(refs([...pool.practice, ...pool.control]).some((id) => id.startsWith("Б4-1"))).toBe(false);
  });

  it("offers other approved calls of comparable difficulty, not only the prepared ones", () => {
    expect(pool.problem).toBeNull();
    expect(pool.practice.length).toBeGreaterThan(2);
    for (const o of [...pool.practice, ...pool.control]) expect(Math.abs(o.difficulty - byRef("Б4-1").difficulty)).toBeLessThanOrEqual(2);
    expect(pool.practice.some((o) => !o.marked)).toBe(true);
    // The methodologist's controls come first; a reserved control is never a practice.
    expect(pool.control[0].marked).toBe(true);
    expect(refs(pool.practice)).not.toContain("Б11-1");
  });

  it("leaves out calls where the place cannot be checked or that never ring by themselves", () => {
    const ids = refs([...pool.practice, ...pool.control]);
    for (const id of ids) expect(misfit("op112.location", byRef(id), null)).toBeNull();
    expect(misfit("op112.location", byRef("НВ-1"), null) ?? misfit("op112.location", byRef("Б5-1-ош"), null)).not.toBeNull();
    expect(misfit("op112.location", byRef("Б5-1-ош"), null)).toBe("card_error");
  });

  it("does not take a control the student has already heard", () => {
    const heard = new Set(caseKeys(byRef("Б11-1")));
    const again = buildPool("op112.location", approved, { source: byRef("Б4-1"), service: null, seen: heard });
    expect(refs(again.control)).not.toContain("Б11-1");
    expect(unsuitable("op112.location", byRef("Б11-1"), { source: byRef("Б4-1"), service: null, seen: heard }, "control")).toMatch(/уже встречал/);
    // A practice may be a familiar situation: it stays on the list, marked for the teacher, after the new ones.
    const familiar = new Set(caseKeys(byRef("Б26-1")));
    const known = buildPool("op112.location", approved, { source: byRef("Б4-1"), service: null, seen: familiar });
    expect(known.practice.find((o) => o.id === "Б26-1")?.seen).toBe(true);
    expect(known.practice.at(-1)?.id).toBe("Б26-1");
    expect(refs(known.control)).not.toContain("Б26-1");
  });
});

describe("ДДС practice and control for «отразить доклад бригады» follow the place's service and territory", () => {
  it("a district place gets only cases whose card can be on its territory and whose reference has a crew for it", () => {
    const pool = buildPool("dds.report_record", approved, { source: byRef("Б2-1"), service: district, seen: none });
    expect(pool.problem).toBeNull();
    const ids = refs([...pool.practice, ...pool.control]);
    // Cases of the city ambulance only (the old default choice) would come as another territory's card: refused.
    for (const id of ["Б11-2", "Б14-2", "Б24-2"]) expect(ids).not.toContain(id);
    expect(ids).not.toContain("Б2-1");
    expect(ids).not.toContain("Б2-1-ош");
    for (const id of ids) expect(misfit("dds.report_record", byRef(id), district)).toBeNull();
    expect(misfit("dds.report_record", byRef("Б11-2"), district)).toBe("reference");
  });

  it("the default settlement place has its pool too", () => {
    const pool = buildPool("dds.report_record", approved, { source: byRef("Б5-1"), service: voronovo, seen: none });
    expect(pool.problem).toBeNull();
    expect(refs(pool.practice)).not.toContain("Б5-1");
  });

  it("the city ambulance place keeps the prepared cases first", () => {
    const pool = buildPool("dds.report_record", approved, { source: byRef("Б5-2"), service: ambulance, seen: none });
    expect(pool.practice[0].id).toBe("Б11-2");
    expect(pool.control.slice(0, 2).every((o) => o.marked)).toBe(true);
  });

  it("says why and what to do when the place's service has no such case, instead of refusing after «Назначить»", () => {
    const pool = buildPool("dds.report_record", approved, { source: byRef("Б2-1"), service: prefecture, seen: none });
    expect(pool.practice).toEqual([]);
    expect(pool.problem).toMatch(/префектуры/);
    expect(pool.problem).toMatch(/Сценарии/);
  });

  it("does not offer for practice the only case that could still be a new control", () => {
    const seen = new Set(["Б17-1", "Б5-1"].flatMap((ref) => caseKeys(byRef(ref))));
    const pool = buildPool("dds.report_record", approved, { source: byRef("Б2-1"), service: district, seen });
    expect(refs(pool.control)).toEqual(["Б4-1"]);
    expect(refs(pool.practice)).not.toContain("Б4-1");
    expect(pool.practice.length).toBeGreaterThan(0);
  });

  it("says so when every suitable control is already familiar to the student", () => {
    const seen = new Set(all.flatMap((s) => caseKeys(s)));
    const pool = buildPool("dds.report_record", approved, { source: byRef("Б2-1"), service: district, seen });
    expect(pool.control).toEqual([]);
    expect(pool.problem).toMatch(/новый для ученика/);
  });
});
