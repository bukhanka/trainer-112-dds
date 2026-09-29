import { describe, expect, it, vi } from "vitest";
const rows = vi.hoisted(() => ({ attempts: [] as Record<string, unknown>[] }));
vi.mock("@/lib/db", () => ({ db: {
  attempt: { findMany: async ({ where }: { where: { id?: string; lessonId?: string } }) => (where.lessonId ? rows.attempts.filter((a) => !where.id || a.id === where.id) : []) },
  scenario: { findMany: async () => [] },
  seat: { findMany: async () => [] },
  incident: { findMany: async () => [] },
  call: { findMany: async () => [] },
} }));
import { followUpCandidates } from "./options";
const check = (ok: boolean) => ({ code: "op112.address.house", title: "Дом", group: "address", ok, source: "rule" });
const attempt = (id: string, ok: boolean) => ({ id, studentId: "student", kind: "OP112", criteria: [check(ok)], override: null, scenarioId: null,
  student: { fullName: "Учебный ученик" }, seat: { service: null }, sourceFollowUps: [] });

describe("confirmed-error candidates", () => {
  it("keeps an older supported error available after a clean later card", async () => {
    rows.attempts = [attempt("new-clean", true), attempt("older-error", false)];
    expect((await followUpCandidates("lesson")).map((c) => c.attemptId)).toEqual(["older-error"]);
    expect((await followUpCandidates("lesson", "older-error")).map((c) => c.attemptId)).toEqual(["older-error"]);
  });

  it("says why when there is no approved case at all, instead of an empty choice", async () => {
    rows.attempts = [attempt("older-error", false)];
    const [candidate] = await followUpCandidates("lesson", "older-error");
    expect(candidate.pool.practice).toEqual([]);
    expect(candidate.pool.problem).toMatch(/Утвердите ещё один сценарий/);
  });
});
