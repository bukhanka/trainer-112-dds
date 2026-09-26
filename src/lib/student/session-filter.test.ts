import { describe, expect, it } from "vitest";
import { isOtherSessionPractice } from "./results";

const viewer = { practiceKey: "k-mine", sessionId: "s-mine" };

describe("practice of a shared demo account", () => {
  it("keeps class lessons for everyone", () => {
    expect(isOtherSessionPractice({ cardSource: "generated" }, viewer)).toBe(false);
  });
  it("keeps my own practice", () => {
    expect(isOtherSessionPractice({ practice: true, practiceKey: "k-mine" }, viewer)).toBe(false);
    expect(isOtherSessionPractice({ practice: true, sessionId: "s-mine" }, viewer)).toBe(false);
  });
  it("hides practice started under another login session", () => {
    expect(isOtherSessionPractice({ practice: true, practiceKey: "k-other" }, viewer)).toBe(true);
    expect(isOtherSessionPractice({ practice: true, sessionId: "s-other" }, viewer)).toBe(true);
  });
  it("does not filter without a viewer (teacher views, tests)", () => {
    expect(isOtherSessionPractice({ practice: true, practiceKey: "k-other" })).toBe(false);
  });
});
