import { describe, expect, it, vi } from "vitest";
import { weightsForAttempt } from "./weights";
import { recomputeAllScores } from "./recompute";
import type { Prisma } from "@prisma/client";

const frozen = { timeliness: 5, statusOrder: 2, comments: 2, address: 3, services: 3, completeness: 1, literacy: 1, timeZeroAt: 2 };
const current = { ...frozen, timeliness: 1 };
const checked = [{ code: "time", group: "timeliness", title: "Вовремя", ok: false, source: "rule" }];

describe("control scores keep their assignment conditions", () => {
  it("reads the frozen profile only for the learner of this control lesson", async () => {
    const client = { followUp: { findFirst: vi.fn(async ({ where }: { where: { sourceAttempt: { studentId: string } } }) =>
      where.sourceAttempt.studentId === "student" ? { sourceSnapshot: { weights: frozen } } : null) },
      weightProfile: { findFirst: async () => ({ weights: current, id: "active", name: "later", updatedAt: new Date() }) } };
    expect((await weightsForAttempt(client as never, "control", "student")).timeliness).toBe(5);
    expect((await weightsForAttempt(client as never, "control", "another")).timeliness).toBe(1);
    expect(client.followUp.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ controlLessonId: "control" }) }));
  });

  it("reweights ordinary attempts while leaving an already published control score alone", async () => {
    const writes = vi.fn(async () => 1);
    const fake = { attempt: { findMany: async () => [
      { id: "ordinary", criteria: checked, override: null, score: 100, lesson: { controlFollowUps: [] } },
      { id: "control", criteria: checked, override: null, score: 100, lesson: { controlFollowUps: [{ id: "linked" }] } },
    ] }, $executeRaw: writes };
    const result = await recomputeAllScores(fake as unknown as Prisma.TransactionClient, current);
    expect(result).toEqual({ total: 2, changed: 1 });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(writes.mock.calls)).not.toContain("control");
  });
});
