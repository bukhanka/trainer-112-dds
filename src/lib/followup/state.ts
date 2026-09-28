import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { readCriteria, readOverrides } from "@/lib/review/draft";
import { effectiveChecks, goalEvidenceSchema, goalOutcome, isControl, learningMeta, reviewDigest, SKILLS, type SkillKey } from "./skills";
import { scenarioDigest } from "./service";

export type FollowUpState = "cancelled" | "source_changed" | "planned" | "practice" | "review_practice" | "control_ready" | "control" | "review_control" | "achieved" | "not_achieved" | "insufficient";

type Db = typeof db | Prisma.TransactionClient;
type Link = Awaited<ReturnType<typeof loadFollowUp>>;

export async function loadFollowUp(client: Db, id: string) {
  return client.followUp.findUnique({ where: { id }, include: {
    sourceAttempt: true,
    practiceLesson: { include: { seats: true } },
    controlLesson: { include: { seats: true } },
  } });
}

function snapshot(raw: unknown): { studentId?: string; role?: string; practiceScenarioId?: string; controlScenarioId?: string; practiceDigest?: string; controlDigest?: string; passScore?: number; maxCritical?: number } {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as ReturnType<typeof snapshot> : {};
}

export function sourceIsCurrent(link: NonNullable<Link>): boolean {
  const a = link.sourceAttempt;
  return a.reviewStatus !== "PENDING" && a.reviewedAt != null && reviewDigest({
    criteria: readCriteria(a.criteria), override: readOverrides(a.override), reviewedAt: a.reviewedAt, teacherComment: a.teacherComment,
  }) === link.sourceReviewDigest;
}

async function checkedAttempt(client: Db, lessonId: string, studentId: string, scenarioId: string) {
  const attempts = await client.attempt.findMany({ where: { lessonId, studentId, scenarioId }, orderBy: { createdAt: "desc" } });
  return attempts[0] ?? null;
}

/** Server-owned state; a delivered card alone is never completion. */
export async function followUpState(client: Db, link: NonNullable<Link>): Promise<FollowUpState> {
  if (link.cancelledAt) return "cancelled";
  if (!sourceIsCurrent(link)) return "source_changed";
  const snap = snapshot(link.sourceSnapshot);
  const studentId = link.sourceAttempt.studentId;
  if (link.practiceLesson.status === "DRAFT") return "planned";
  if (link.practiceLesson.status === "RUNNING") return "practice";
  const practiced = snap.practiceScenarioId ? await checkedAttempt(client, link.practiceLessonId, studentId, snap.practiceScenarioId) : null;
  if (!practiced || practiced.reviewStatus === "PENDING") return "review_practice";
  if (link.controlLesson.status === "DRAFT") return "control_ready";
  if (link.controlLesson.status === "RUNNING") return "control";
  const controlled = snap.controlScenarioId ? await checkedAttempt(client, link.controlLessonId, studentId, snap.controlScenarioId) : null;
  if (!controlled || controlled.reviewStatus === "PENDING") return "review_control";
  const skill = link.skillKey as SkillKey;
  if (!(skill in SKILLS)) return "insufficient";
  const parsed = goalEvidenceSchema.safeParse(link.controlJudgment);
  const evidence = parsed.success && parsed.data.attemptId === controlled.id && parsed.data.reviewDigest === reviewDigest({
    criteria: readCriteria(controlled.criteria), override: readOverrides(controlled.override), reviewedAt: controlled.reviewedAt, teacherComment: controlled.teacherComment,
  }) ? parsed.data : null;
  const result = goalOutcome(skill, effectiveChecks(readCriteria(controlled.criteria), readOverrides(controlled.override)), evidence);
  return result === "achieved" ? "achieved" : result === "failed" ? "not_achieved" : "insufficient";
}

/** A control card can be released only while its source and completed practice remain valid. */
export async function canIssueControl(client: Db, lessonId: string, studentId: string, scenarioId: string): Promise<boolean> {
  const links = await client.followUp.findMany({
    where: { controlLessonId: lessonId, cancelledAt: null, sourceAttempt: { studentId } },
    include: { sourceAttempt: true, practiceLesson: { include: { seats: true } }, controlLesson: { include: { seats: true } } },
  });
  for (const link of links) {
    if (snapshot(link.sourceSnapshot).controlScenarioId !== scenarioId) continue;
    if (await followUpState(client, link) === "control") return true;
  }
  return false;
}

/** Checks teacher lessons at start, including direct API calls and lesson copies. */
export async function followUpStartProblem(client: Db, lessonId: string, assignedScenarioIds: string[]): Promise<string | null> {
  if (!assignedScenarioIds.length) return null;
  // Check links before metadata: a linked scenario can be edited back to "ordinary" while the lesson is still a draft.
  const linked = await client.followUp.findMany({
    where: { OR: [{ practiceLessonId: lessonId }, { controlLessonId: lessonId }] },
    include: { sourceAttempt: true, practiceLesson: { include: { seats: true } }, controlLesson: { include: { seats: true } } },
  });
  const controlRows = await client.scenario.findMany({ where: { id: { in: assignedScenarioIds } }, select: { id: true, learningMeta: true } });
  if (!linked.length && !controlRows.some((s) => learningMeta(s.learningMeta))) return null;
  if (controlRows.some((s) => isControl(s.learningMeta)) && !linked.some((f) => f.controlLessonId === lessonId && !f.cancelledAt)) {
    return "Контрольные задания запускаются только из действующей отработки";
  }
  for (const f of linked.filter((r) => !r.cancelledAt)) {
    if (!sourceIsCurrent(f)) return "Исходный разбор изменён — проверьте и отмените старое назначение";
    const snap = snapshot(f.sourceSnapshot);
    const isPractice = f.practiceLessonId === lessonId;
    const id = isPractice ? snap.practiceScenarioId : snap.controlScenarioId;
    const expected = isPractice ? snap.practiceDigest : snap.controlDigest;
    const scenario = id ? await client.scenario.findUnique({ where: { id } }) : null;
    if (!scenario || scenario.status !== "APPROVED" || scenarioDigest(scenario) !== expected) {
      return "Сценарий изменился после назначения — проверьте его перед занятием";
    }
    const studentId = f.sourceAttempt.studentId;
    const seat = (isPractice ? f.practiceLesson : f.controlLesson).seats.find((s) => s.studentId === studentId);
    if (!seat || seat.scenarioIds.length !== 1 || seat.scenarioIds[0] !== id) return "Задание места изменилось после назначения";
    if (!isPractice) {
      if (f.practiceLesson.status !== "FINISHED") return "Сначала завершите отработку";
      const state = await followUpState(client, f);
      if (state !== "control_ready") return "Не все участники завершили отработку и проверку; откройте их попытки или отмените отсутствующих";
    }
  }
  return null;
}
