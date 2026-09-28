/**
 * Many attempts confirmed as they are, in one action: «Утвердить выбранные» and «Утвердить все без критичных ошибок»
 * in the list of a lesson's attempts. A class of 25 gives hundreds of attempts; the teacher reads the ones that need a
 * look and confirms the rest in one go.
 *
 * Pure: which of the chosen attempts are confirmed and why the others are left to be decided one by one. Every
 * confirmed attempt gets exactly the decision «Верно» gives (review.ts, planReview: the draft as it is, score by the
 * active weights) and its own audit record; the route writes all of it in one transaction.
 *
 * Left for a look:
 *   decided  — already confirmed or corrected;
 *   edited   — returned to review after the teacher changed checks or wrote a comment: «as it is» would drop them;
 *   critical — «без критичных ошибок» only: a critical check of the draft failed (a look-alike street, a refused
 *              incident of the service's profile), the teacher decides it personally;
 *   missing  — not an attempt of this lesson (another lesson's id, a foreign one, a deleted one).
 */
import { z } from "zod";
import type { CriterionResult, Overrides } from "@/lib/scoring/score";
import type { BulkSkips } from "./bulk-text";

export type { BulkSkips } from "./bulk-text";

export const BULK_LIMIT = 2000;

export const bulkConfirmSchema = z.object({
  ids: z.array(z.string().min(1).max(64)).min(1).max(BULK_LIMIT),
  noCritical: z.boolean().optional().default(false),
});

export type BulkCandidate = {
  id: string;
  reviewStatus: "PENDING" | "CONFIRMED" | "OVERRIDDEN";
  criteria: CriterionResult[];
  override: Overrides | null;
  teacherComment: string | null;
};

export const emptySkips = (): BulkSkips => ({ decided: 0, edited: 0, critical: 0, missing: 0 });

/** A failed critical check in the draft — what «Верно» would confirm. */
export const draftHasCritical = (criteria: CriterionResult[]) => criteria.some((c) => c.critical && c.ok === false);

/** The teacher has already worked on it: checks changed or a comment written, then returned to review. */
export const teacherEdited = (a: { override: Overrides | null; teacherComment: string | null }) =>
  Boolean((a.override && Object.keys(a.override).length) || a.teacherComment?.trim());

export function planBulkConfirm<T extends BulkCandidate>(ids: string[], rows: T[], noCritical: boolean): { confirm: T[]; skipped: BulkSkips } {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const skipped = emptySkips();
  const confirm: T[] = [];
  for (const id of new Set(ids)) {
    const a = byId.get(id);
    if (!a) skipped.missing++;
    else if (a.reviewStatus !== "PENDING") skipped.decided++;
    else if (teacherEdited(a)) skipped.edited++;
    else if (noCritical && draftHasCritical(a.criteria)) skipped.critical++;
    else confirm.push(a);
  }
  return { confirm, skipped };
}
