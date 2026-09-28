import { describe, expect, it } from "vitest";
import { eligiblePair, goalOutcome, isControl, learningMeta, SKILLS } from "./skills";
import type { CriterionResult } from "@/lib/scoring/score";

const check = (code: string, ok: boolean | null, critical = false): CriterionResult => ({
  code, ok, critical, group: "address", title: code, source: "rule",
});
const seen = { attemptId: "a", reviewDigest: "a".repeat(64), observed: true, evidence: "Оператор уточнил дом в разговоре", reviewedById: "teacher", reviewedAt: new Date().toISOString() };
const meta = (purpose: "practice" | "control", caseKey: string) => learningMeta({ purpose, role: "OP112", skillKeys: ["op112.location"], equivalenceKey: "same-level", caseKey });

describe("follow-up validity", () => {
  it("reserves control cases, including copied presentations of an already seen case", () => {
    expect(isControl(meta("control", "b"))).toBe(true);
    expect(eligiblePair(meta("practice", "a"), meta("control", "b"), "op112.location")).toBe(true);
    expect(eligiblePair(meta("practice", "a"), meta("control", "a"), "op112.location")).toBe(false);
  });
  it("does not call a guessed but correctly typed address a clarified location", () => {
    const checks = SKILLS["op112.location"].required.map((code) => check(code, true));
    expect(goalOutcome("op112.location", checks, null)).toBe("insufficient");
    expect(goalOutcome("op112.location", checks, { ...seen, observed: false })).toBe("failed");
    expect(goalOutcome("op112.location", checks, seen)).toBe("achieved");
  });
  it("does not pass on missing evidence, a wrong status, or a critical error", () => {
    const checks = SKILLS["dds.report_record"].required.map((code) => check(code, true));
    expect(goalOutcome("dds.report_record", checks.slice(1), seen)).toBe("insufficient");
    expect(goalOutcome("dds.report_record", [check(checks[0].code, false), checks[1]], seen)).toBe("failed");
    expect(goalOutcome("dds.report_record", [...checks, check("critical", false, true)], seen)).toBe("failed");
  });
});
