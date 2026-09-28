import { createHash } from "node:crypto";
import { z } from "zod";
import { applyOverrides, type CriterionResult, type Overrides } from "@/lib/scoring/score";

export const SKILLS = {
  "op112.location": {
    title: "Уточнить и записать место происшествия",
    role: "OP112",
    required: ["op112.address.street", "op112.address.house"],
  },
  "dds.report_record": {
    title: "Отразить доклад бригады в статусе и записи",
    role: "DDS",
    required: ["dds.status_by_facts", "dds.literacy"],
  },
} as const;
export type SkillKey = keyof typeof SKILLS;
export { skillKeySchema, learningMetaSchema, learningMeta, isControl } from "./metadata";
import type { LearningMeta } from "./metadata";

/** The same caseKey survives copying, so a copy is never a fresh control situation. */
export function eligiblePair(practice: LearningMeta | null, control: LearningMeta | null, skill: SkillKey): boolean {
  const role = SKILLS[skill].role;
  return !!practice && !!control && practice.purpose === "practice" && control.purpose === "control"
    && practice.role === role && control.role === role && practice.skillKeys.includes(skill)
    && control.skillKeys.includes(skill) && practice.equivalenceKey === control.equivalenceKey
    && practice.caseKey !== control.caseKey;
}

export function effectiveChecks(criteria: CriterionResult[], override: Overrides | null): CriterionResult[] {
  return applyOverrides(criteria, override);
}

/** Hash only a teacher-reviewed decision, never a client-supplied version. */
export function reviewDigest(value: { criteria: CriterionResult[]; override: Overrides | null; reviewedAt: Date | null; teacherComment: string | null }): string {
  return createHash("sha256")
    .update(JSON.stringify([value.criteria, value.override, value.reviewedAt?.toISOString() ?? null, value.teacherComment]))
    .digest("hex");
}

export type GoalEvidence = {
  attemptId: string;
  reviewDigest: string;
  observed: boolean;
  evidence: string;
  reviewedById: string;
  reviewedAt: string;
};
export const goalEvidenceSchema = z.object({
  attemptId: z.string().min(1),
  reviewDigest: z.string().regex(/^[a-f0-9]{64}$/),
  observed: z.boolean(),
  evidence: z.string().trim().min(12).max(1000),
  reviewedById: z.string().min(1),
  reviewedAt: z.string().datetime(),
});

export type GoalOutcome = "achieved" | "failed" | "insufficient";
/** The form must match the incident and the teacher must observe the actual skill in the conversation/work. */
export function goalOutcome(skill: SkillKey, checks: CriterionResult[], judgment: GoalEvidence | null): GoalOutcome {
  const relevant = SKILLS[skill].required.map((code) => checks.find((c) => c.code === code));
  if (checks.some((c) => c.critical && c.ok === false)) return "failed";
  if (relevant.some((c) => c?.ok === false)) return "failed";
  if (relevant.some((c) => c?.ok !== true)) return "insufficient";
  if (!judgment) return "insufficient";
  return judgment.observed ? "achieved" : "failed";
}
