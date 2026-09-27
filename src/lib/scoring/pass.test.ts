import { describe, expect, it } from "vitest";
import { describePassRules, passLabel, passRulesOf, passVerdict } from "./pass";
import type { CriterionResult } from "./score";

const street: CriterionResult = { code: "op112.address.street", group: "address", title: "Улица совпадает с местом происшествия", ok: false, critical: true, source: "rule" };
const time: CriterionResult = { code: "time", group: "timeliness", title: "Вовремя", ok: true, source: "rule" };

describe("pass criteria of a lesson", () => {
  it("passes at the pass mark and without critical errors", () => {
    expect(passVerdict(70, [time], null, { passScore: 70, maxCritical: 0 })).toEqual({ passed: true, reasons: [] });
    expect(passVerdict(69, [time], null, { passScore: 70, maxCritical: 0 })).toEqual({ passed: false, reasons: ["балл 69 ниже 70"] });
  });

  it("fails a failed critical check even with a high score, unless the lesson allows it", () => {
    expect(passVerdict(90, [street, time], null, { passScore: 70, maxCritical: 0 })).toEqual({ passed: false, reasons: ["критичная ошибка: «Улица не совпадает с местом происшествия»"] });
    expect(passVerdict(90, [street, time], null, { passScore: 70, maxCritical: 1 })?.passed).toBe(true);
    expect(passVerdict(90, [street, { ...street, code: "s2" }], null, { passScore: 70, maxCritical: 1 })?.reasons).toEqual(["критичных ошибок 2, допустимо 1"]);
  });

  it("follows the teacher's correction of a check", () => {
    expect(passVerdict(90, [street, time], { "op112.address.street": true }, { passScore: 70, maxCritical: 0 })?.passed).toBe(true);
  });

  it("has no verdict without a score", () => {
    expect(passVerdict(null, [], null, { passScore: 70, maxCritical: 0 })).toBeNull();
    expect(passLabel(null)).toBe("—");
  });

  it("reads the criteria from the lesson settings with defaults for old lessons", () => {
    expect(passRulesOf({ passScore: 80, maxCritical: 1 })).toEqual({ passScore: 80, maxCritical: 1 });
    expect(passRulesOf({})).toEqual({ passScore: 70, maxCritical: 0 });
    expect(passRulesOf({ passScore: "90", maxCritical: -1 })).toEqual({ passScore: 70, maxCritical: 0 });
    expect(passRulesOf(null)).toEqual({ passScore: 70, maxCritical: 0 });
    expect(describePassRules({ passScore: 70, maxCritical: 0 })).toBe("балл не ниже 70, без критичных ошибок");
    expect(describePassRules({ passScore: 60, maxCritical: 2 })).toBe("балл не ниже 60, критичных ошибок не больше 2");
  });
});
