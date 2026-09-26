/**
 * Scoring contract shared by the 112 and ДДС checks.
 *
 * Every check produces a CriterionResult that belongs to one weight group. The score is a weighted
 * share of passed checks over applicable ones; `ok: null` means «не применимо» and is left out of
 * the denominator, so an attempt with nothing to check is not 100 %. A failed critical check
 * (for example a look-alike street) caps the score. Raw results are stored on Attempt.criteria, so
 * changing weights recomputes every attempt instantly.
 */

export const WEIGHT_GROUPS = {
  timeliness: "Время: 30 с, 3 мин, набор карточки",
  statusOrder: "Порядок статусов",
  comments: "Комментарии и «кому передано»",
  address: "Адрес",
  services: "Тип происшествия и службы",
  completeness: "Полнота карточки и вопросы",
  literacy: "Понятность текста",
} as const;

export type WeightGroup = keyof typeof WEIGHT_GROUPS;
export type Weights = Record<WeightGroup, number>;

export type CriterionResult = {
  code: string; // stable id of the check, e.g. dds.ack_in_time
  group: WeightGroup;
  title: string; // shown in the review, Russian
  ok: boolean | null; // null = не применимо
  critical?: boolean;
  evidence?: string; // quote or timing that proves the verdict
  expected?: string; // what the right action was
  source: "rule" | "ai";
};

/** Teacher corrections: check code → new verdict. */
export type Overrides = Record<string, boolean | null>;

export const CRITICAL_CAP = 40;

export function applyOverrides(criteria: CriterionResult[], overrides?: Overrides | null): CriterionResult[] {
  if (!overrides) return criteria;
  return criteria.map((c) => (c.code in overrides ? { ...c, ok: overrides[c.code] } : c));
}

/** 0–100, or null when no check applies. */
export function computeScore(criteria: CriterionResult[], weights: Weights, overrides?: Overrides | null): number | null {
  const list = applyOverrides(criteria, overrides);
  let weighted = 0;
  let total = 0;
  for (const group of Object.keys(WEIGHT_GROUPS) as WeightGroup[]) {
    const applicable = list.filter((c) => c.group === group && c.ok !== null);
    const w = weights[group] ?? 0;
    if (!applicable.length || w <= 0) continue;
    weighted += (w * applicable.filter((c) => c.ok).length) / applicable.length;
    total += w;
  }
  if (!total) return null;
  const score = Math.round((weighted / total) * 100);
  const criticalFailed = list.some((c) => c.critical && c.ok === false);
  return criticalFailed ? Math.min(score, CRITICAL_CAP) : score;
}
