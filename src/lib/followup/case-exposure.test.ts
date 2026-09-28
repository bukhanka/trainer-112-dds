import { describe, expect, it } from "vitest";
import { caseHeardOnCall } from "./service";

describe("novel control case", () => {
  it("counts a call as an exposure before any 112 card was saved, including a copied case", () => {
    expect(caseHeardOnCall(["original", "copy"], [{ counterpart: { scenarioId: "copy" } }])).toBe(true);
    expect(caseHeardOnCall(["original", "copy"], [{ counterpart: { scenarioId: "other" } }])).toBe(false);
  });
});
