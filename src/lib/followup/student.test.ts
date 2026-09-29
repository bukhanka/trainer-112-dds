import { describe, expect, it } from "vitest";
import { followUpTarget } from "./student";

describe("the error a follow-up is for", () => {
  it("comes from the checks the teacher assigned it on, never from another published remark", () => {
    const snapshot = { criteria: [
      { code: "op112.address.street", group: "address", title: "Улица", ok: true, source: "rule" },
      { code: "op112.address.house", group: "address", title: "Дом", ok: false, evidence: "дом: «13»", expected: "дом 11", source: "rule" },
    ] };
    expect(followUpTarget("op112.location", snapshot)).toEqual(expect.objectContaining({ title: "Неверно указаны дом, корпус или строение", evidence: "дом: «13»", expected: "дом 11" }));
    expect(followUpTarget("op112.location", { criteria: [] })).toBeNull();
    expect(followUpTarget("unknown.goal", snapshot)).toBeNull();
  });
});
