import { describe, expect, it } from "vitest";
import { readDataJson } from "@/lib/routing/reference-json";
import { CATEGORY_DEFS, categoryDef, categoryOfType, typeInCategory } from "./categories";

type Row = { code: number; groupId: number; finalType: string; sign1: string | null };
const types = readDataJson<{ types: Row[] }>("classifier.json").types;
const scenarios = readDataJson<{ category: string; truth: { typeCodes: number[] } }[]>("scenarios.json");
const byCode = new Map(types.map((t) => [t.code, t]));

describe("scenario categories and the classifier", () => {
  it("covers every classifier group, each group once", () => {
    const groups = CATEGORY_DEFS.flatMap((d) => d.groups).sort((a, b) => a - b);
    expect(groups).toEqual(Array.from({ length: 24 }, (_, i) => i + 1));
  });

  it("files the ticket leaves in the ticket's own category (the main leaf of almost every ticket)", () => {
    let same = 0;
    let total = 0;
    for (const s of scenarios) {
      const t = byCode.get(s.truth.typeCodes[0]);
      if (!t) continue;
      total++;
      if (categoryOfType(t) === s.category) same++;
    }
    // The tickets file a few leaves by meaning (Укус животного → медицина, Нанесение телесных повреждений → правопорядок).
    expect(same / total).toBeGreaterThan(0.85);
  });

  it("gives a suspicious object to «угроза взрыва», not to «правопорядок»", () => {
    const suspicious = types.find((t) => t.finalType === "Подозрительный предмет")!;
    expect(categoryOfType(suspicious)).toBe("угроза взрыва");
    expect(typeInCategory(categoryDef("правопорядок")!, suspicious)).toBe(false);
    const fight = types.find((t) => t.finalType === "Драка на улице")!;
    expect(categoryOfType(fight)).toBe("правопорядок");
  });

  it("finds a category by name regardless of case and ё", () => {
    expect(categoryDef("Ребенок")?.name).toBe("ребёнок");
    expect(categoryDef("дтп")?.name).toBe("ДТП");
    expect(categoryDef("служебный")).toBeUndefined();
  });
});
