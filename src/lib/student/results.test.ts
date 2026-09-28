import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildPublishedFeedback } from "@/lib/review/published-feedback";
import type { CriterionResult } from "@/lib/scoring/score";
import { getStudentAttempt } from "./results";

const { findFirst } = vi.hoisted(() => ({ findFirst: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { attempt: { findFirst } } }));

const reviewedAt = new Date("2026-09-28T12:00:00.000Z");
const criteria: CriterionResult[] = [
  { code: "street", group: "address", title: "Улица записана верно", ok: false, evidence: "В карточке другая улица", expected: "Уточнить название улицы", source: "rule" },
];
const row = () => ({
  id: "attempt-a",
  kind: "OP112" as const,
  createdAt: new Date("2026-09-28T11:00:00.000Z"),
  reviewStatus: "CONFIRMED" as const,
  reviewedAt,
  score: 40,
  criteria,
  override: null,
  teacherComment: null,
  feedback: buildPublishedFeedback({ criteria, override: null, teacherComment: null, reviewedAt }),
  aiDraft: { summary: "SECRET_AI_DRAFT" },
  lesson: { id: "lesson-a", title: "Занятие", startedAt: null, settings: { practice: true, practiceKey: "mine" } },
  scenario: { title: "Задача" },
  incident: { number: 7 },
});
const viewer = { practiceKey: "mine", sessionId: "session-a" };

beforeEach(() => findFirst.mockReset());

describe("student attempt detail", () => {
  it("queries by owner id and returns only the published note, never the AI draft", async () => {
    findFirst.mockResolvedValue(row());
    const detail = await getStudentAttempt("student-a", "attempt-a", viewer);
    expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "attempt-a", studentId: "student-a" } }));
    expect(detail?.status).toBe("CONFIRMED");
    if (detail?.status !== "CONFIRMED") return;
    expect(detail.feedback?.priority?.nextAction).toBe("Уточнить название улицы");
    expect(detail.feedback?.priority?.evidence).toBe("В карточке другая улица");
    expect(JSON.stringify(detail)).not.toContain("SECRET_AI_DRAFT");
    expect(JSON.stringify(detail)).not.toContain("reviewDigest");
  });

  it("hides every review field while pending, even when a stale published note is in storage", async () => {
    findFirst.mockResolvedValue({ ...row(), reviewStatus: "PENDING" });
    const detail = await getStudentAttempt("student-a", "attempt-a", viewer);
    expect(detail).toEqual({ status: "PENDING", id: "attempt-a", kind: "OP112", createdAt: "2026-09-28T11:00:00.000Z", lessonTitle: "Занятие", task: "Задача" });
    expect(JSON.stringify(detail)).not.toContain("score");
  });

  it("hides a stale note after late criteria replacement or a review change", async () => {
    findFirst.mockResolvedValue({ ...row(), criteria: [{ ...criteria[0], evidence: "late" }] });
    const detail = await getStudentAttempt("student-a", "attempt-a", viewer);
    expect(detail?.status).toBe("CONFIRMED");
    if (detail?.status === "CONFIRMED") expect(detail.feedback).toBeNull();
  });

  it("returns 404-equivalent for another session's practice or a foreign attempt", async () => {
    findFirst.mockResolvedValue({ ...row(), lesson: { ...row().lesson, settings: { practice: true, practiceKey: "other" } } });
    expect(await getStudentAttempt("student-a", "attempt-a", viewer)).toBeNull();
    findFirst.mockResolvedValue(null);
    expect(await getStudentAttempt("student-a", "foreign", viewer)).toBeNull();
  });
});
