import { describe, expect, it } from "vitest";
import { passwordProblem } from "./password";
import { clampPolicyValue, DEMO_MIN_SESSION_HOURS, POLICY_FIELDS, resolvePolicy } from "./policy";

const field = (key: string) => POLICY_FIELDS.find((f) => f.key === key)!;

describe("access policy", () => {
  it("takes the .env values as defaults and the built-in ones without them", () => {
    expect(resolvePolicy({}, {}, false)).toEqual({ minPasswordLength: 8, maxFailedLogins: 5, lockMinutes: 15, sessionHours: 10 });
    expect(resolvePolicy({}, { MAX_FAILED_LOGINS: "7", LOCK_MINUTES: "30", SESSION_HOURS: "12" }, false)).toMatchObject({ maxFailedLogins: 7, lockMinutes: 30, sessionHours: 12 });
  });

  it("puts a saved setting over the default", () => {
    const saved = { "policy.minPasswordLength": 12, "policy.maxFailedLogins": 3, "policy.lockMinutes": 60, "policy.sessionHours": 4 };
    expect(resolvePolicy(saved, { SESSION_HOURS: "10" }, false)).toEqual({ minPasswordLength: 12, maxFailedLogins: 3, lockMinutes: 60, sessionHours: 4 });
  });

  it("never leaves the safe bounds, whatever is stored or set in .env", () => {
    const wild = { "policy.minPasswordLength": 2, "policy.maxFailedLogins": 1000, "policy.lockMinutes": -5, "policy.sessionHours": 0 };
    expect(resolvePolicy(wild, {}, false)).toEqual({ minPasswordLength: 8, maxFailedLogins: 20, lockMinutes: 1, sessionHours: 1 });
    expect(resolvePolicy({}, { MAX_FAILED_LOGINS: "1" }, false).maxFailedLogins).toBe(3);
    expect(resolvePolicy({ "policy.lockMinutes": "abc" }, {}, false).lockMinutes).toBe(15);
    expect(clampPolicyValue(field("sessionHours"), "", false)).toBeNull();
    expect(clampPolicyValue(field("sessionHours"), "7.6", false)).toBe(8);
  });

  it("on the demo stand a session cannot be made shorter than a few hours", () => {
    expect(resolvePolicy({ "policy.sessionHours": 1 }, {}, true).sessionHours).toBe(DEMO_MIN_SESSION_HOURS);
    expect(resolvePolicy({ "policy.sessionHours": 1 }, {}, false).sessionHours).toBe(1);
  });
});

describe("password rule", () => {
  it("follows the policy length and never goes below 8", () => {
    expect(passwordProblem("abc12345")).toBeNull();
    expect(passwordProblem("abc12345", 10)).toBe("Пароль короче 10 символов");
    expect(passwordProblem("abc1234", 4)).toBe("Пароль короче 8 символов");
    expect(passwordProblem("abcdefghij", 10)).toBe("Пароль должен содержать буквы и цифры");
  });
});
