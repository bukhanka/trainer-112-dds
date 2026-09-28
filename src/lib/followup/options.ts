import { db } from "@/lib/db";
import { readCriteria, readOverrides } from "@/lib/review/draft";
import { effectiveChecks, learningMeta, SKILLS, type SkillKey } from "./skills";
import type { Candidate, CaseChoice } from "@/app/teacher/followups/AssignFollowUp";

export async function followUpCases(): Promise<CaseChoice[]> {
  const rows = await db.scenario.findMany({ where: { status: "APPROVED" }, select: { id: true, title: true, difficulty: true, learningMeta: true } });
  return rows.flatMap((s) => {
    const meta = learningMeta(s.learningMeta);
    return meta ? [{ id: s.id, title: s.title, difficulty: s.difficulty, meta }] : [];
  });
}

/** The newest confirmed attempt per learner; a pending result cannot become a diagnosis. */
export async function followUpCandidates(lessonId: string, sourceAttemptId?: string): Promise<Candidate[]> {
  const attempts = await db.attempt.findMany({ where: { lessonId, reviewStatus: { not: "PENDING" }, ...(sourceAttemptId ? { id: sourceAttemptId } : {}) }, orderBy: { createdAt: "desc" }, select: {
    id: true, studentId: true, kind: true, criteria: true, override: true,
    student: { select: { fullName: true } }, seat: { select: { service: { select: { shortName: true } } } },
    sourceFollowUps: { where: { cancelledAt: null }, select: { skillKey: true } },
  } });
  const seen = new Set<string>();
  return attempts.flatMap((a) => {
    const failed = effectiveChecks(readCriteria(a.criteria), readOverrides(a.override)).filter((c) => c.ok === false);
    const skills = (Object.keys(SKILLS) as SkillKey[]).filter((skill) => SKILLS[skill].role === a.kind
      && failed.some((c) => (SKILLS[skill].required as readonly string[]).includes(c.code))
      && !a.sourceFollowUps.some((f) => f.skillKey === skill)
      && (sourceAttemptId || !seen.has(`${a.studentId}:${skill}`)));
    for (const skill of skills) seen.add(`${a.studentId}:${skill}`);
    return skills.length ? [{ attemptId: a.id, name: a.student.fullName, role: a.kind, service: a.seat.service?.shortName ?? null, skills }] : [];
  });
}
