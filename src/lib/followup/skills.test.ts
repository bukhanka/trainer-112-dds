import { describe, expect, it } from "vitest";
import { goalChecksPassed, goalErrors, goalOutcome, isControl, learningMeta, observationOutcome, SKILLS } from "./skills";
import type { CriterionResult } from "@/lib/scoring/score";

const check = (code: string, ok: boolean | null, critical = false): CriterionResult => ({
  code, ok, critical, group: "address", title: code, source: "rule",
});
const seen = { attemptId: "a", reviewDigest: "a".repeat(64), observed: true, evidence: "Оператор уточнил дом в разговоре", reviewedById: "teacher", reviewedAt: new Date().toISOString() };
const meta = (purpose: "practice" | "control", caseKey: string) => learningMeta({ purpose, role: "OP112", skillKeys: ["op112.location"], equivalenceKey: "same-level", caseKey });

describe("follow-up validity", () => {
  it("reserves control cases", () => {
    expect(isControl(meta("control", "b"))).toBe(true);
    expect(isControl(meta("practice", "a"))).toBe(false);
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

describe("an observation of the practice never confirms the goal", () => {
  it("maps the practice verdict to what happened with hints, and keeps the control verdict", () => {
    expect(observationOutcome("practice", "achieved")).toBe("practice_done");
    expect(observationOutcome("practice", "failed")).toBe("practice_not_done");
    expect(observationOutcome("practice", "insufficient")).toBe("practice_insufficient");
    expect(observationOutcome("control", "achieved")).toBe("achieved");
    expect(observationOutcome("control", "failed")).toBe("failed");
  });
});

describe("the error of the goal", () => {
  it("takes only failed checks of the goal: a late card is not the address error the practice is for", () => {
    const checks = [check("op112.typing_time", false), check("op112.address.street", true), check("op112.address.house", false)];
    expect(goalErrors("op112.location", checks).map((c) => c.code)).toEqual(["op112.address.house"]);
  });
  it("leaves only the teacher's observation when every check of the goal passed and nothing critical failed", () => {
    const passed = SKILLS["op112.location"].required.map((code) => check(code, true));
    expect(goalChecksPassed("op112.location", passed)).toBe(true);
    expect(goalChecksPassed("op112.location", [...passed, check("op112.empty", false, true)])).toBe(false);
    expect(goalChecksPassed("op112.location", [passed[0], check("op112.address.house", null)])).toBe(false);
  });
});
