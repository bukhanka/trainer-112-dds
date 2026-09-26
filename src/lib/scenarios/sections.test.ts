import { describe, expect, it } from "vitest";
import { callerSchema, nextApprovals, presentSections, statusFor } from "./sections";

describe("partial approval", () => {
  const s = { caller: { fullName: "x" }, truth: { a: 1 }, ddsCard: null, ddsReference: {} };

  it("counts only sections that have content", () => {
    expect(presentSections(s)).toEqual(["caller", "truth"]);
  });

  it("approves the scenario when every present section is approved", () => {
    expect(statusFor(["caller"], ["caller", "truth"], "DRAFT")).toBe("DRAFT");
    expect(statusFor(["caller", "truth"], ["caller", "truth"], "DRAFT")).toBe("APPROVED");
    expect(statusFor(["caller"], ["caller", "truth"], "APPROVED")).toBe("DRAFT");
    expect(statusFor(["caller", "truth"], ["caller", "truth"], "ARCHIVED")).toBe("ARCHIVED");
  });

  it("adds and removes sections in a stable order and drops unknown keys", () => {
    expect(nextApprovals(["truth", "junk"], ["caller"], true)).toEqual(["caller", "truth"]);
    expect(nextApprovals(["caller", "truth"], ["truth"], false)).toEqual(["caller"]);
  });
});

describe("callerSchema", () => {
  it("keeps extra generator fields and requires the essentials", () => {
    const ok = callerSchema.safeParse({ fullName: "Иванова", visibleAddress: "у школы", situation: "Горит", facts: [], mood: "x" });
    expect(ok.success && (ok.data as Record<string, unknown>).mood).toBe("x");
    expect(callerSchema.safeParse({ fullName: "", visibleAddress: "a", situation: "b" }).success).toBe(false);
  });
});
