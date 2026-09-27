import { describe, expect, it } from "vitest";
import {
  desiredCorrections,
  guidanceText,
  learnerOf,
  pickGuidance,
  planCorrectionSync,
  relevance,
  type CorrectionContext,
  type GuidanceRow,
} from "./corrections";

// A gas leak in a flat: type 13010101 of group 13 («Запах газа»), scenario «s-gas».
const ctx: CorrectionContext = { scenarioId: "s-gas", typeCode: 13010101, typeGroupId: 13, category: "газ" };

let n = 0;
const row = (over: Partial<GuidanceRow>): GuidanceRow => ({
  id: `c${++n}`,
  code: "dds.ai.literacy",
  title: "ИИ: комментарии понятны следующему диспетчеру",
  source: "ai",
  scenarioId: null,
  typeCode: null,
  typeGroupId: null,
  category: null,
  typeName: null,
  draftOk: false,
  draftEvidence: "Непонятно: «АБ»",
  teacherOk: true,
  comment: `Правка ${n}`,
  createdAt: new Date(Date.UTC(2026, 8, 20, 10, n)),
  ...over,
});

describe("which corrections a model check is shown", () => {
  it("ranks the same scenario, then the same type, then the same group, then the rest", () => {
    expect(relevance(ctx, { scenarioId: "s-gas", typeCode: null, typeGroupId: null, category: null })).toBe(3);
    expect(relevance(ctx, { scenarioId: "s-other", typeCode: 13010101, typeGroupId: 13, category: "газ" })).toBe(2);
    expect(relevance(ctx, { scenarioId: null, typeCode: 13020000, typeGroupId: 13, category: null })).toBe(1);
    expect(relevance(ctx, { scenarioId: null, typeCode: 1010101, typeGroupId: 1, category: "пожар" })).toBe(0);
    // Without a classifier group, the scenario category stands in for it.
    expect(relevance({ ...ctx, typeCode: null, typeGroupId: null }, { scenarioId: null, typeCode: null, typeGroupId: null, category: "газ" })).toBe(1);
  });

  it("takes at most five, the most relevant first and newer first within the same relevance", () => {
    const other = row({ typeCode: 1010101, typeGroupId: 1 });
    const groupOld = row({ typeGroupId: 13, createdAt: new Date(Date.UTC(2026, 8, 1)) });
    const groupNew = row({ typeGroupId: 13, createdAt: new Date(Date.UTC(2026, 8, 25)) });
    const sameType = row({ typeCode: 13010101, typeGroupId: 13 });
    const sameScenario = row({ scenarioId: "s-gas" });
    const more = [row({}), row({}), row({})];
    const picked = pickGuidance(ctx, [other, groupOld, ...more, groupNew, sameType, sameScenario], "dds.ai.literacy");
    expect(picked).toHaveLength(5);
    expect(picked.slice(0, 4).map((r) => r.id)).toEqual([sameScenario.id, sameType.id, groupNew.id, groupOld.id]);
    expect(picked[4].id).toBe(more[2].id); // the newest of the other situations
  });

  it("reads only its own check and the rule of the same meaning", () => {
    const own = row({});
    const rule = row({ code: "dds.literacy", source: "rule" });
    const foreign = row({ code: "dds.ack_in_time", source: "rule" });
    const op112 = row({ code: "op112.ai.said" });
    expect(pickGuidance(ctx, [own, rule, foreign, op112], "dds.ai.literacy").map((r) => r.id)).toEqual([own.id, rule.id]);
    expect(pickGuidance(ctx, [row({ code: "op112.said.gas" }), op112], "op112.ai.said")).toHaveLength(2);
    expect(pickGuidance(ctx, [own], "dds.decision")).toEqual([]);
  });

  it("puts the check's own corrections before the rule's in the same situation", () => {
    const rule = row({ code: "dds.literacy", scenarioId: "s-gas", createdAt: new Date(Date.UTC(2026, 8, 26)) });
    const own = row({ scenarioId: "s-gas", createdAt: new Date(Date.UTC(2026, 8, 2)) });
    expect(pickGuidance(ctx, [rule, own], "dds.ai.literacy").map((r) => r.id)).toEqual([own.id, rule.id]);
  });

  it("shows one comment given to several checks of an attempt once", () => {
    const a = row({ code: "op112.said.gas", comment: "Газ записан в описании — так можно" });
    const b = row({ code: "op112.said.floor", comment: "газ  записан в описании — так можно" });
    expect(pickGuidance(ctx, [a, b], "op112.ai.said")).toHaveLength(1);
  });

  it("knows who learns from a check", () => {
    expect(learnerOf("dds.literacy")?.code).toBe("dds.ai.literacy");
    expect(learnerOf("op112.said.victims")?.code).toBe("op112.ai.said");
    expect(learnerOf("op112.description.first100")?.code).toBe("op112.ai.description");
    expect(learnerOf("dds.ack_in_time")).toBeNull();
  });
});

describe("the corrections in the prompt", () => {
  it("quotes the draft, the decision and the comment, marked as examples and not orders", () => {
    const text = guidanceText(ctx, [row({ scenarioId: "s-gas", typeName: "запах газа: в квартире", comment: "АБ — аварийная бригада, так пишут все" })]);
    expect(text).toContain("методика учебного центра");
    expect(text).toContain("а не команды");
    expect(text).toContain("[запах газа: в квартире, то же задание]");
    expect(text).toContain("Черновик: ошибка («Непонятно: «АБ»»)");
    expect(text).toContain("Преподаватель решил: верно — «АБ — аварийная бригада, так пишут все»");
    expect(guidanceText(ctx, [])).toBe("");
  });

  it("keeps a long comment short", () => {
    const text = guidanceText(ctx, [row({ comment: "очень ".repeat(200) })]);
    expect(text.length).toBeLessThan(700);
  });
});

describe("corrections follow the teacher's decision", () => {
  it("«ИИ неправ» keeps every changed check with the comment, «Верно» none, reopening changes nothing", () => {
    expect(desiredCorrections({ reviewStatus: "OVERRIDDEN", override: { a: true, b: null }, teacherComment: " Так можно " })).toEqual([
      { code: "a", teacherOk: true, comment: "Так можно" },
      { code: "b", teacherOk: null, comment: "Так можно" },
    ]);
    expect(desiredCorrections({ reviewStatus: "CONFIRMED", override: null, teacherComment: "ok" })).toEqual([]);
    expect(desiredCorrections({ reviewStatus: "PENDING", override: { a: true }, teacherComment: "x" })).toBeNull();
  });

  it("adds new ones, keeps the same and retires what the teacher took back or changed", () => {
    const active = [
      { id: "keep", code: "a", teacherOk: true, comment: "Так можно" },
      { id: "gone", code: "b", teacherOk: false, comment: "Так можно" },
      { id: "changed", code: "c", teacherOk: true, comment: "Старый комментарий" },
    ];
    const plan = planCorrectionSync(active, [
      { code: "a", teacherOk: true, comment: "Так можно" },
      { code: "c", teacherOk: true, comment: "Новый комментарий" },
      { code: "d", teacherOk: null, comment: "Так можно" },
    ]);
    expect(plan.retire.sort()).toEqual(["changed", "gone"]);
    expect(plan.create.map((c) => c.code)).toEqual(["c", "d"]);
  });
});
