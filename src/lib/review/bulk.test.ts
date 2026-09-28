import { describe, expect, it } from "vitest";
import type { CriterionResult } from "@/lib/scoring/score";
import { bulkConfirmSchema, draftHasCritical, planBulkConfirm, teacherEdited, type BulkCandidate } from "./bulk";
import { bulkResultText } from "./bulk-text";

const check = (code: string, ok: boolean | null, critical = false): CriterionResult => ({ code, group: "address", title: code, ok, critical, source: "rule" }) as CriterionResult;
const attempt = (id: string, extra: Partial<BulkCandidate> = {}): BulkCandidate => ({
  id,
  reviewStatus: "PENDING",
  criteria: [check("a", true), check("b", false)],
  override: null,
  teacherComment: null,
  ...extra,
});

describe("planBulkConfirm: what «Утвердить списком» confirms and what it leaves for a look", () => {
  const rows = [
    attempt("clean"),
    attempt("street", { criteria: [check("op112.address.street", false, true)] }),
    attempt("done", { reviewStatus: "CONFIRMED" }),
    attempt("fixed", { reviewStatus: "OVERRIDDEN", override: { b: true } }),
    attempt("reopened", { override: { b: true } }),
    attempt("commented", { teacherComment: "Смотри адрес" }),
  ];

  it("confirms the chosen drafts as they are, a critical one too when the teacher chose it", () => {
    const plan = planBulkConfirm(["clean", "street"], rows, false);
    expect(plan.confirm.map((a) => a.id)).toEqual(["clean", "street"]);
    expect(plan.skipped).toEqual({ decided: 0, edited: 0, critical: 0, missing: 0 });
  });

  it("«без критичных ошибок» leaves a failed critical check for the teacher", () => {
    const plan = planBulkConfirm(["clean", "street"], rows, true);
    expect(plan.confirm.map((a) => a.id)).toEqual(["clean"]);
    expect(plan.skipped.critical).toBe(1);
  });

  it("never touches what is decided, what the teacher changed, or ids of another lesson", () => {
    const plan = planBulkConfirm(["done", "fixed", "reopened", "commented", "foreign", "clean", "clean"], rows, true);
    expect(plan.confirm.map((a) => a.id)).toEqual(["clean"]);
    expect(plan.skipped).toEqual({ decided: 2, edited: 2, critical: 0, missing: 1 });
  });

  it("reads the draft's critical checks and the teacher's traces", () => {
    expect(draftHasCritical([check("x", false, true)])).toBe(true);
    expect(draftHasCritical([check("x", true, true), check("y", false)])).toBe(false);
    expect(draftHasCritical([check("x", null, true)])).toBe(false);
    expect(teacherEdited({ override: null, teacherComment: null })).toBe(false);
    expect(teacherEdited({ override: {}, teacherComment: "  " })).toBe(false);
    expect(teacherEdited({ override: { a: false }, teacherComment: null })).toBe(true);
    expect(teacherEdited({ override: null, teacherComment: "как надо" })).toBe(true);
  });

  it("accepts a class-sized list and refuses an empty or broken one", () => {
    expect(bulkConfirmSchema.safeParse({ ids: Array.from({ length: 600 }, (_, i) => `a${i}`) }).success).toBe(true);
    expect(bulkConfirmSchema.parse({ ids: ["a"] }).noCritical).toBe(false);
    expect(bulkConfirmSchema.safeParse({ ids: [] }).success).toBe(false);
    expect(bulkConfirmSchema.safeParse({ ids: "a" }).success).toBe(false);
    expect(bulkConfirmSchema.safeParse(null).success).toBe(false);
  });
});

describe("bulkResultText", () => {
  it("says what was confirmed and what is left to decide one by one", () => {
    expect(bulkResultText(9, { decided: 0, edited: 0, critical: 0, missing: 0 })).toBe("Подтверждено: 9.");
    expect(bulkResultText(9, { decided: 1, edited: 1, critical: 2, missing: 0 })).toBe(
      "Подтверждено: 9. Решите по одной: 2 — с критичной ошибкой, 1 — с правками или комментарием преподавателя. Пропущены: уже решены — 1.",
    );
  });
});
