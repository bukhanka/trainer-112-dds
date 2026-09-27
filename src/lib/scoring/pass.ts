/**
 * «Зачтено / не зачтено» — the pass criteria of a lesson (ТЗ п.99, «критерии успешности»).
 *
 * The lesson sets the pass mark (score at least N, 70 by default) and how many failed critical checks
 * are allowed (none by default). The verdict is not stored: like the score, it is computed from the
 * stored checks and the teacher's corrections every time it is shown, so new weights or a corrected
 * check change it at once. For the student and in the reports only confirmed attempts get a verdict;
 * the draft verdict is shown to the teacher alone.
 */
import { errorTitle } from "./errors";
import { applyOverrides, type CriterionResult, type Overrides } from "./score";

export type PassRules = { passScore: number; maxCritical: number };
export type PassVerdict = { passed: boolean; reasons: string[] };

export const DEFAULT_PASS: PassRules = { passScore: 70, maxCritical: 0 };

/** The criteria of a lesson from Lesson.settings; anything missing or broken falls back to the defaults. */
export function passRulesOf(settings: unknown): PassRules {
  const s = settings && typeof settings === "object" ? (settings as Record<string, unknown>) : {};
  const int = (v: unknown, max: number, fallback: number) => (typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= max ? v : fallback);
  return { passScore: int(s.passScore, 100, DEFAULT_PASS.passScore), maxCritical: int(s.maxCritical, 10, DEFAULT_PASS.maxCritical) };
}

/** null — nothing to judge: no check applied, so there is no score either. */
export function passVerdict(score: number | null, criteria: CriterionResult[], overrides: Overrides | null, rules: PassRules): PassVerdict | null {
  if (score == null) return null;
  const critical = applyOverrides(criteria, overrides).filter((c) => c.critical && c.ok === false);
  const reasons: string[] = [];
  if (score < rules.passScore) reasons.push(`балл ${score} ниже ${rules.passScore}`);
  if (critical.length > rules.maxCritical) {
    reasons.push(
      rules.maxCritical
        ? `критичных ошибок ${critical.length}, допустимо ${rules.maxCritical}`
        : `критичная ошибка: ${critical.map((c) => `«${errorTitle(c)}»`).join(", ")}`,
    );
  }
  return { passed: reasons.length === 0, reasons };
}

export function passLabel(v: PassVerdict | null): string {
  return v == null ? "—" : v.passed ? "зачтено" : "не зачтено";
}

/** «балл не ниже 70, без критичных ошибок» */
export function describePassRules(rules: PassRules): string {
  const critical = rules.maxCritical ? `критичных ошибок не больше ${rules.maxCritical}` : "без критичных ошибок";
  return `балл не ниже ${rules.passScore}, ${critical}`;
}
