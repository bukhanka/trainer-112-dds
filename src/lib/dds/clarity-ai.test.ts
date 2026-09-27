import { afterEach, describe, expect, it, vi } from "vitest";
import type { GuidanceRow } from "@/lib/review/corrections";
import { clarityAiMessages, clarityBasis, clarityFromReply, evaluateDdsClarityAi, type ClarityAiInput } from "./clarity-ai";

const input: ClarityAiInput = {
  service: "Поселение Вороновское",
  card: "запах газа: в квартире · Москва, пос. Вороновское, д. 5",
  comments: [{ status: "FINISHED", text: "АБ на месте, кран перекрыт, утечка устранена", final: true }],
};
const ctx = { scenarioId: "s1", typeCode: 13010101, typeGroupId: 13, category: "газ" };
const correction: GuidanceRow = {
  ...ctx,
  id: "corr-1",
  code: "dds.ai.literacy",
  title: "ИИ: комментарии понятны следующему диспетчеру",
  source: "ai",
  typeName: "запах газа: в квартире",
  draftOk: false,
  draftEvidence: "Непонятно: «АБ»",
  teacherOk: true,
  comment: "АБ — аварийная бригада газовой службы, так пишут все",
  createdAt: new Date("2026-09-25T09:00:00Z"),
};

describe("the model's clarity check of ДДС comments", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("puts the comments, the card and the teacher corrections into the prompt", () => {
    const [system, user] = clarityAiMessages(input, ctx, [correction]);
    expect(system.content).toContain("без звонка");
    expect(system.content).toContain("Опечатки, которые не мешают понять смысл, ошибкой не считай");
    expect(system.content).toContain("Преподаватель решил: верно — «АБ — аварийная бригада газовой службы, так пишут все»");
    expect(user.content).toContain("Работы завершены: «АБ на месте, кран перекрыт, утечка устранена»");
    expect(user.content).toContain("Карточка: запах газа: в квартире");
    expect(clarityAiMessages(input, ctx, [])[0].content).not.toContain("Правки преподавателей");
  });

  it("keeps a quote only if it is in the comments and records the corrections it was shown", () => {
    const basis = clarityBasis(input.comments);
    const real = clarityFromReply({ clear: false, fragment: "АБ на месте", better: "Аварийная бригада на месте" }, input, [correction], basis);
    expect(real).toMatchObject({ ok: false, evidence: "Непонятно: «АБ на месте»", expected: "Аварийная бригада на месте", source: "ai", learned: ["corr-1"], basis });
    const invented = clarityFromReply({ clear: false, fragment: "бригада уехала домой", better: "" }, input, [], basis);
    expect(invented.evidence).toBe("Без звонка не понять, что сделано и чем закончилось");
    expect(clarityFromReply({ clear: true, fragment: "", better: "" }, input, [], basis)).toMatchObject({ ok: true, evidence: "Понятно без звонка", learned: [] });
  });

  it("is «не применимо» without a model and never throws", async () => {
    vi.stubEnv("LLM_BASE_URL", "");
    const res = await evaluateDdsClarityAi(input, ctx, [correction]);
    expect(res).toMatchObject({ code: "dds.ai.literacy", ok: null, source: "ai" });
    expect(res.evidence).toContain("модель не настроена");
  });

  it("fingerprints the text, not the moment", () => {
    expect(clarityBasis(input.comments)).toBe(clarityBasis([{ ...input.comments[0], text: ` ${input.comments[0].text} ` }]));
    expect(clarityBasis(input.comments)).not.toBe(clarityBasis([{ ...input.comments[0], text: "Утечка устранена" }]));
  });
});
