import { beforeEach, describe, expect, it, vi } from "vitest";
import { feedbackRevision } from "./published-feedback";
import type { CriterionResult } from "@/lib/scoring/score";
import { DEFAULT_WEIGHTS } from "@/lib/scoring/weight-config";

const { findFirst, updateMany, auditInTx } = vi.hoisted(() => ({ findFirst: vi.fn(), updateMany: vi.fn(), auditInTx: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { $transaction: async (work: (tx: unknown) => unknown) => work({ attempt: { findFirst, updateMany } }) } }));
vi.mock("@/lib/teacher/access", () => ({
  teacherApi: async () => ({ id: "teacher-a", login: "teacher", role: "TEACHER" }),
  attemptScope: () => ({ lesson: { teacherId: "teacher-a" } }),
  auditInTx,
  jsonError: (message: string, status = 400) => Response.json({ error: message }, { status }),
  readJson: (request: Request) => request.json(),
}));
vi.mock("@/lib/scoring/weights", () => ({ getActiveWeights: async () => ({ weights: DEFAULT_WEIGHTS }), weightsForAttempt: async () => DEFAULT_WEIGHTS, lockScores: async () => {} }));
vi.mock("@/lib/review/corrections-db", () => ({ syncCorrections: async () => ({ created: 0, retired: 0 }) }));

import { POST } from "@/app/api/teacher/attempts/[id]/review/route";

const criteria: CriterionResult[] = [{ code: "street", group: "address", title: "Улица записана верно", ok: false, evidence: "Записана другая улица", expected: "Переспросить улицу", source: "rule" }];
const attempt = () => ({
  id: "attempt-a",
  reviewStatus: "PENDING",
  reviewedAt: null,
  criteria,
  aiDraft: { summary: "SECRET_AI_DRAFT" },
  override: null,
  score: 0,
  teacherComment: null,
  reviewedBy: null,
  lesson: { status: "FINISHED" },
});
const request = (body: unknown) => new Request("http://localhost/api/teacher/attempts/attempt-a/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const context = { params: Promise.resolve({ id: "attempt-a" }) } as never;

beforeEach(() => {
  findFirst.mockReset();
  updateMany.mockReset().mockResolvedValue({ count: 1 });
  auditInTx.mockReset();
});

describe("single teacher publication", () => {
  it("rejects stale teacher-approved text before writing an attempt", async () => {
    findFirst.mockResolvedValue(attempt());
    const response = await POST(request({ action: "confirm", feedback: { revision: feedbackRevision(criteria, { summary: "older" }), summary: "Old text" } }), context);
    expect(response.status).toBe(409);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("publishes a deterministic snapshot in the same update as the verdict", async () => {
    findFirst.mockResolvedValue(attempt());
    const response = await POST(request({ action: "confirm" }), context);
    expect(response.status).toBe(200);
    const data = updateMany.mock.calls[0][0].data;
    expect(data.reviewStatus).toBe("CONFIRMED");
    expect(data.feedback).toMatchObject({ version: 1, source: "rules", priority: { code: "street", nextAction: "Переспросить улицу" } });
    expect(JSON.stringify(data.feedback)).not.toContain("SECRET_AI_DRAFT");
    expect(auditInTx).toHaveBeenCalledOnce();
  });

  it("clears the published snapshot when the teacher reopens the decision", async () => {
    findFirst.mockResolvedValue({ ...attempt(), reviewStatus: "CONFIRMED", reviewedAt: new Date("2026-09-28T12:00:00.000Z") });
    const response = await POST(request({ action: "reopen" }), context);
    expect(response.status).toBe(200);
    const data = updateMany.mock.calls[0][0].data;
    expect(data.reviewStatus).toBe("PENDING");
    expect(data.feedback).not.toBeNull(); // Prisma.JsonNull sentinel, persisted as JSON null
    expect(data.reviewedAt).toBeNull();
  });
});
