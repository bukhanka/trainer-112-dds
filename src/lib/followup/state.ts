import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { shortName } from "@/lib/format";
import { readCriteria, readOverrides } from "@/lib/review/draft";
import { seenSituations } from "./exposure";
import { caseKeys } from "./pool";
import { effectiveChecks, goalChecksPassed, goalEvidenceSchema, goalOutcome, isControl, learningMeta, reviewDigest, scenarioDigest, SKILLS, type SkillKey } from "./skills";

/**
 * Server-owned stage of a follow-up. «_missed» — the lesson of the stage is over and the student has no attempt in it
 * (absent, the call missed): nothing to review, the teacher repeats the stage or cancels. «observe_control» — the
 * control checks passed; the teacher still has to observe the action itself in the conversation or the card.
 */
export type FollowUpState =
  | "cancelled"
  | "source_changed"
  | "planned"
  | "practice"
  | "practice_missed"
  | "review_practice"
  | "control_ready"
  | "control"
  | "control_missed"
  | "review_control"
  | "observe_control"
  | "achieved"
  | "not_achieved"
  | "insufficient";

type Db = typeof db | Prisma.TransactionClient;
type Link = Awaited<ReturnType<typeof loadFollowUp>>;

export async function loadFollowUp(client: Db, id: string) {
  return client.followUp.findUnique({ where: { id }, include: {
    sourceAttempt: true,
    practiceLesson: { include: { seats: true } },
    controlLesson: { include: { seats: true } },
  } });
}

export type FollowUpSnapshot = {
  studentId?: string;
  role?: "OP112" | "DDS";
  serviceId?: number | null;
  practiceScenarioId?: string;
  controlScenarioId?: string;
  practiceDigest?: string;
  controlDigest?: string;
  passScore?: number;
  maxCritical?: number;
  criteria?: unknown;
};

export function snapshot(raw: unknown): FollowUpSnapshot {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? raw as FollowUpSnapshot : {};
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
  if (!practiced) return "practice_missed";
  if (practiced.reviewStatus === "PENDING") return "review_practice";
  if (link.controlLesson.status === "DRAFT") return "control_ready";
  if (link.controlLesson.status === "RUNNING") return "control";
  const controlled = snap.controlScenarioId ? await checkedAttempt(client, link.controlLessonId, studentId, snap.controlScenarioId) : null;
  if (!controlled) return "control_missed";
  if (controlled.reviewStatus === "PENDING") return "review_control";
  const skill = link.skillKey as SkillKey;
  if (!(skill in SKILLS)) return "insufficient";
  const checks = effectiveChecks(readCriteria(controlled.criteria), readOverrides(controlled.override));
  const parsed = goalEvidenceSchema.safeParse(link.controlJudgment);
  const evidence = parsed.success && parsed.data.attemptId === controlled.id && parsed.data.reviewDigest === reviewDigest({
    criteria: readCriteria(controlled.criteria), override: readOverrides(controlled.override), reviewedAt: controlled.reviewedAt, teacherComment: controlled.teacherComment,
  }) ? parsed.data : null;
  if (!evidence && goalChecksPassed(skill, checks)) return "observe_control";
  const result = goalOutcome(skill, checks, evidence);
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

/** Why a student's control cannot start yet, with what the teacher does about it. */
const NOT_READY: Partial<Record<FollowUpState, string>> = {
  planned: "отработка ещё не начата",
  practice: "отработка ещё идёт",
  practice_missed: "отработка завершена без его попытки — повторите для него отработку или отмените назначение",
  review_practice: "попытка отработки ждёт вашей проверки",
  source_changed: "исходный разбор изменён — проверьте и отмените старое назначение",
};

/** Checks teacher lessons at start, including direct API calls and lesson copies. */
export async function followUpStartProblem(client: Db, lessonId: string, assignedScenarioIds: string[]): Promise<string | null> {
  if (!assignedScenarioIds.length) return null;
  // Check links before metadata: a linked scenario can be edited back to "ordinary" while the lesson is still a draft.
  const linked = await client.followUp.findMany({
    where: { OR: [{ practiceLessonId: lessonId }, { controlLessonId: lessonId }] },
    include: { sourceAttempt: { include: { student: { select: { fullName: true } } } }, practiceLesson: { include: { seats: true } }, controlLesson: { include: { seats: true } } },
  });
  const controlRows = await client.scenario.findMany({ where: { id: { in: assignedScenarioIds } }, select: { id: true, learningMeta: true } });
  if (!linked.length && !controlRows.some((s) => learningMeta(s.learningMeta))) return null;
  if (controlRows.some((s) => isControl(s.learningMeta)) && !linked.some((f) => f.controlLessonId === lessonId && !f.cancelledAt)) {
    return "Контрольные задания запускаются только из действующей отработки";
  }
  const waiting: string[] = [];
  for (const f of linked.filter((r) => !r.cancelledAt)) {
    const who = shortName(f.sourceAttempt.student?.fullName ?? "ученик");
    if (!sourceIsCurrent(f)) return `Исходный разбор изменён (${who}) — проверьте и отмените старое назначение`;
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
    if (isPractice) continue;
    const state = await followUpState(client, f);
    if (state !== "control_ready") {
      waiting.push(`${who}: ${NOT_READY[state] ?? "отработка не завершена и не проверена"}`);
      continue;
    }
    // A control must still be new: the student may have met the case in another lesson since it was assigned.
    const seen = (await seenSituations(client, [studentId], [lessonId])).get(studentId) ?? new Set<string>();
    if (caseKeys(scenario).some((k) => seen.has(k))) {
      waiting.push(`${who}: контрольную ситуацию ученик уже встретил после назначения — замените контроль на странице его ошибки`);
    }
  }
  return waiting.length ? `Контроль пока нельзя начать. ${waiting.join("; ")}.` : null;
}
