import { createHash } from "node:crypto";
import { z } from "zod";
import { applyOverrides, type CriterionResult, type Overrides } from "@/lib/scoring/score";

export const SKILLS = {
  "op112.location": {
    title: "Уточнить и записать место происшествия",
    role: "OP112",
    required: ["op112.address.street", "op112.address.house"],
    /** What to do differently next time — shown to the student next to the error the practice is for. */
    advice: "Если заявитель называет место неточно — переспросите улицу, номер дома, корпус и ориентир, дождитесь ответа и запишите в карточку то, что он подтвердил.",
  },
  "dds.report_record": {
    title: "Отразить доклад бригады в статусе и записи",
    role: "DDS",
    required: ["dds.status_by_facts", "dds.literacy"],
    advice: "Ставьте статус только после доклада бригады о выезде, прибытии и окончании работ, а в итоге полными словами напишите, что сделано и кому передано.",
  },
} as const;
export type SkillKey = keyof typeof SKILLS;
export { skillKeySchema, learningMetaSchema, learningMeta, isControl } from "./metadata";

/** The failed checks of the goal in a reviewed attempt: the error a follow-up is assigned for. */
export function goalErrors(skill: SkillKey, checks: CriterionResult[]): CriterionResult[] {
  return checks.filter((c) => c.ok === false && (SKILLS[skill].required as readonly string[]).includes(c.code));
}

/** Every check of the goal applies and passed: what is left is the teacher's observation of the action itself. */
export function goalChecksPassed(skill: SkillKey, checks: CriterionResult[]): boolean {
  return !checks.some((c) => c.critical && c.ok === false) && SKILLS[skill].required.every((code) => checks.find((c) => c.code === code)?.ok === true);
}

export function effectiveChecks(criteria: CriterionResult[], override: Overrides | null): CriterionResult[] {
  return applyOverrides(criteria, override);
}

/** What a follow-up froze of a scenario: a changed caller, reference or card means the case must be checked again. */
export const scenarioDigest = (s: { caller: unknown; truth: unknown; ddsCard: unknown; ddsReference: unknown; learningMeta: unknown }) =>
  createHash("sha256").update(JSON.stringify([s.caller, s.truth, s.ddsCard, s.ddsReference, s.learningMeta])).digest("hex");

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

/**
 * What an observation says. Only the control, a new situation without hints, can confirm the goal; an observation of
 * the practice records whether the student did the action with hints — it never reads as a confirmed skill.
 */
export type ObservationOutcome = GoalOutcome | "practice_done" | "practice_not_done" | "practice_insufficient";
export function observationOutcome(stage: "practice" | "control", verdict: GoalOutcome): ObservationOutcome {
  if (stage === "control") return verdict;
  return verdict === "achieved" ? "practice_done" : verdict === "failed" ? "practice_not_done" : "practice_insufficient";
}
