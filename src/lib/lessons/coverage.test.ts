import { describe, expect, it } from "vitest";
import { coverageWarnings, lessonCoverage, type CoverageScenario } from "./coverage";

const s = (id: string, category: string, okrug: string | null, district: string | null, approved = true): CoverageScenario => ({ id, category, okrug, district, approved });

// The library: fires in two okrugs, one ДТП, medicine only as a draft with an approved caller.
const library = [
  s("f1", "пожар", "СЗАО", "Щукино"),
  s("f2", "пожар", "ЦАО", "Арбат"),
  s("d1", "ДТП", "СЗАО", "Щукино"),
  s("m1", "медицина", "ЦАО", "Арбат", false),
];
const dds = { role: "DDS" as const, scenarioIds: [] };
/** The warnings about empty categories, without the one about a narrow choice (the test library is small). */
const aboutEmpty = (...args: Parameters<typeof coverageWarnings>) => coverageWarnings(...args).filter((w) => !w.startsWith("Карточки будут повторяться"));
const op = { role: "OP112" as const, scenarioIds: [] };

describe("will every place get cards", () => {
  it("counts approved scenarios per category, in total and in the location", () => {
    const c = lessonCoverage(library, { categories: [], location: { okrug: "СЗАО" } }, [dds]);
    expect(c.counts).toEqual([
      { name: "ДТП", approved: 1, here: 1 },
      { name: "пожар", approved: 2, here: 1 },
    ]);
    expect(c.pool).toEqual({ dds: 2, op112: 2 });
    expect(c.blocked).toBeNull();
  });

  it("warns about a chosen category without approved scenarios, but lets the lesson start", () => {
    const settings = { categories: ["пожар", "медицина"] };
    const c = lessonCoverage(library, settings, [dds]);
    expect(c.empty).toEqual(["медицина"]);
    expect(c.blocked).toBeNull();
    expect(aboutEmpty(c, settings)).toEqual(["В категории «медицина» нет утверждённых сценариев — места получат карточки только из других категорий."]);
  });

  it("blocks the start when places without tasks would get nothing", () => {
    const settings = { categories: ["медицина"] };
    const c = lessonCoverage(library, settings, [dds]);
    expect(c.blocked).toMatch(/в категории «медицина» нет утверждённых сценариев/);
    expect(c.blocked).toMatch(/«Сценарии»/);
    expect(coverageWarnings(c, settings)).toEqual([]);
    // The location alone can empty the pool as well.
    expect(lessonCoverage(library, { categories: ["ДТП"], location: { okrug: "ЦАО" } }, [dds]).blocked).toMatch(/локации «ЦАО»/);
  });

  it("lets a 112 place play a draft whose caller is approved, a ДДС place does not", () => {
    const settings = { categories: ["медицина"] };
    expect(lessonCoverage(library, settings, [op]).blocked).toBeNull();
    expect(lessonCoverage(library, settings, [op, dds]).blocked).not.toBeNull();
    // No false warning for a lesson of 112 places only.
    const both = { categories: ["пожар", "медицина"] };
    expect(aboutEmpty(lessonCoverage(library, both, [op]), both)).toEqual([]);
    expect(lessonCoverage(library, both, [op, dds]).empty).toEqual(["медицина"]);
  });

  it("does not bother when every place has tasks, or ДДС places take cards from students only", () => {
    const settings = { categories: ["медицина"] };
    expect(lessonCoverage(library, settings, [{ role: "DDS", scenarioIds: ["f1"] }]).blocked).toBeNull();
    const fromStudents = lessonCoverage(library, { ...settings, cardSource: "students" }, [dds]);
    expect(fromStudents.blocked).toBeNull();
    expect(coverageWarnings(fromStudents, settings)).toEqual([]);
  });

  it("names the location in the warning", () => {
    const settings = { categories: ["пожар", "ДТП"], location: { okrug: "ЦАО", district: "Арбат" } };
    const c = lessonCoverage(library, settings, [dds]);
    expect(aboutEmpty(c, settings)).toEqual([
      "В категории «ДТП» нет утверждённых сценариев в локации «ЦАО, Арбат» — места получат карточки только из других категорий.",
    ]);
  });

  it("warns in advance when places without tasks have only a few scenarios", () => {
    const settings = { categories: ["пожар"] };
    const c = lessonCoverage(library, settings, [dds]);
    expect(c.few).toBe(2);
    expect(coverageWarnings(c, settings)).toContain(
      "Карточки будут повторяться: местам без заданий доступно 2 сценария. Добавьте категории, снимите ограничение локации или утвердите ещё сценарии.",
    );
    // Places with their own tasks draw nothing: no warning.
    expect(coverageWarnings(lessonCoverage(library, settings, [{ role: "DDS", scenarioIds: ["f1"] }]), settings)).toEqual([]);
  });

  it("counts tasks for the 112 place only in the category, but not for ДДС places", () => {
    const silent = { id: "q1", category: "тишина и срыв звонка", okrug: "ЦАО", district: "Арбат", approved: true, dds: false };
    const all = [...library, silent];
    const settings = { categories: ["тишина и срыв звонка"] };
    expect(lessonCoverage(all, settings, [op]).counts.find((c) => c.name === "тишина и срыв звонка")).toMatchObject({ approved: 1 });
    expect(lessonCoverage(all, settings, [op]).blocked).toBeNull();
    expect(lessonCoverage(all, settings, [dds]).blocked).toMatch(/только задания для места 112/);
    const mixed = { categories: ["пожар", "тишина и срыв звонка"] };
    expect(aboutEmpty(lessonCoverage(all, mixed, [op, dds]), mixed)).toEqual([
      "В категории «тишина и срыв звонка» только задания для места 112 — места ДДС получат карточки только из других категорий.",
    ]);
  });
});
