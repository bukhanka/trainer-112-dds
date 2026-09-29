import { db } from "@/lib/db";
import { readCriteria, readOverrides } from "@/lib/review/draft";
import type { Candidate } from "./pairing";
import { seenSituations } from "./exposure";
import { buildPool, poolScenarioSelect } from "./pool";
import { effectiveChecks, SKILLS, type SkillKey } from "./skills";

/** Approved scenarios, the pool every follow-up choice is made from. */
export function approvedScenarios() {
  return db.scenario.findMany({ where: { status: "APPROVED" }, select: poolScenarioSelect, orderBy: { title: "asc" } });
}

/**
 * The newest confirmed attempt per learner with an error of a goal, and the cases that suit this learner: the goal's
 * cases for the place's role, service and territory, not the situation of the error, a control new to the learner.
 * A pending result cannot become a diagnosis.
 */
export async function followUpCandidates(lessonId: string, sourceAttemptId?: string): Promise<Candidate[]> {
  const attempts = await db.attempt.findMany({ where: { lessonId, reviewStatus: { not: "PENDING" }, ...(sourceAttemptId ? { id: sourceAttemptId } : {}) }, orderBy: { createdAt: "desc" }, select: {
    id: true, studentId: true, kind: true, criteria: true, override: true, scenarioId: true,
    student: { select: { fullName: true } },
    seat: { select: { service: { select: { id: true, shortName: true, okrug: true, district: true } } } },
    sourceFollowUps: { where: { cancelledAt: null }, select: { skillKey: true } },
  } });
  const seen = new Set<string>();
  const found = attempts.flatMap((a) => {
    const failed = effectiveChecks(readCriteria(a.criteria), readOverrides(a.override)).filter((c) => c.ok === false);
    const skills = (Object.keys(SKILLS) as SkillKey[]).filter((skill) => SKILLS[skill].role === a.kind
      && failed.some((c) => (SKILLS[skill].required as readonly string[]).includes(c.code))
      && !a.sourceFollowUps.some((f) => f.skillKey === skill)
      && (sourceAttemptId || !seen.has(`${a.studentId}:${skill}`)));
    for (const skill of skills) seen.add(`${a.studentId}:${skill}`);
    return skills.length ? [{ attempt: a, skills }] : [];
  });
  if (!found.length) return [];
  const [scenarios, met] = await Promise.all([approvedScenarios(), seenSituations(db, [...new Set(found.map((f) => f.attempt.studentId))])]);
  const sources = await db.scenario.findMany({ where: { id: { in: found.flatMap((f) => (f.attempt.scenarioId ? [f.attempt.scenarioId] : [])) } }, select: poolScenarioSelect });
  return found.map(({ attempt: a, skills }) => {
    const source = sources.find((s) => s.id === a.scenarioId) ?? null;
    const service = a.kind === "DDS" ? a.seat.service : null;
    return {
      attemptId: a.id,
      name: a.student.fullName,
      role: a.kind,
      service: a.seat.service?.shortName ?? null,
      source: source?.title ?? null,
      skills,
      // One goal per role today: the pool of the role's goal.
      pool: buildPool(skills[0], scenarios, { source, service, seen: met.get(a.studentId) ?? new Set() }),
    };
  });
}
