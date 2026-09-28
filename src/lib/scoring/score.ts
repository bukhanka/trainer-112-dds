/**
 * Scoring contract shared by the 112 and ДДС checks.
 *
 * Every check produces a CriterionResult that belongs to one weight group. The score is a weighted
 * share of passed checks over applicable ones; `ok: null` means «не применимо» and is left out of
 * the denominator, so an attempt with nothing to check is not 100 %. A time check that carries its
 * measured time (`timing`) is not all or nothing: past the norm it keeps part of its points, fewer the
 * longer it took (timeCredit). A failed critical check (for example a look-alike street) caps the
 * score. Raw results are stored on Attempt.criteria, so changing weights recomputes every attempt instantly.
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
export type Weights = Record<WeightGroup, number> & {
  /**
   * Time checks: past the norm the points of the check fall linearly and reach zero at this many norms
   * (2 — at twice the norm; 1 — nothing past the norm, the old «уложился или нет»). Absent — TIME_ZERO_AT.
   */
  timeZeroAt?: number;
};

/** Default of Weights.timeZeroAt: a card twice as long as the norm gets nothing for time. */
export const TIME_ZERO_AT = 2;
export const TIME_ZERO_MIN = 1;
export const TIME_ZERO_MAX = 4;

export type CriterionResult = {
  code: string; // stable id of the check, e.g. dds.ack_in_time
  group: WeightGroup;
  title: string; // shown in the review, Russian
  ok: boolean | null; // null = не применимо
  critical?: boolean;
  evidence?: string; // quote or timing that proves the verdict
  expected?: string; // what the right action was
  source: "rule" | "ai";
  /** Model checks: ids of the teacher corrections the model was shown (src/lib/review/corrections.ts). */
  learned?: string[];
  /** Model checks: fingerprint of the text the model judged, so the same text is not sent twice. */
  basis?: string;
  /**
   * Time checks: the measured time and its norm, seconds. `ok` says whether the norm was kept; the points
   * of a late check are timeCredit(sec, normSec, weights.timeZeroAt), so new weights rescore it exactly.
   */
  timing?: { sec: number; normSec: number };
};

/** Teacher corrections: check code → new verdict. */
export type Overrides = Record<string, boolean | null>;

export const CRITICAL_CAP = 40;

export function applyOverrides(criteria: CriterionResult[], overrides?: Overrides | null): CriterionResult[] {
  if (!overrides) return criteria;
  return criteria.map((c) => (c.code in overrides ? { ...c, ok: overrides[c.code] } : c));
}

/** The zero point of the time checks from the weights: TIME_ZERO_MIN…TIME_ZERO_MAX norms, TIME_ZERO_AT when unset. */
export function timeZeroAt(weights: Pick<Weights, "timeZeroAt"> | null | undefined): number {
  const v = weights?.timeZeroAt;
  return typeof v === "number" && Number.isFinite(v) ? Math.min(TIME_ZERO_MAX, Math.max(TIME_ZERO_MIN, v)) : TIME_ZERO_AT;
}

/**
 * Share of the points of a time check, 0–1: all of them within the norm, then linearly fewer and none at
 * `zeroAt` norms. With the 65-second typing norm and zeroAt 2: 1:05 — 1, 1:06 — 0.98, 1:38 — 0.49, 2:10 and later — 0.
 */
export function timeCredit(sec: number, normSec: number, zeroAt: number = TIME_ZERO_AT): number {
  if (!(normSec > 0) || sec <= normSec) return 1;
  const span = (zeroAt - 1) * normSec;
  return span > 0 ? Math.max(0, 1 - (sec - normSec) / span) : 0;
}

/**
 * Points of every applicable check after the teacher's corrections, 0–1 (null — «не применимо»). A passed check
 * gets 1 and a failed one 0 — except a late time check the teacher left as it was: it keeps timeCredit. A verdict
 * the teacher changed is theirs as it is: «Верно» — 1, «Ошибка» — 0.
 */
export function checkCredits(criteria: CriterionResult[], weights: Pick<Weights, "timeZeroAt">, overrides?: Overrides | null): (number | null)[] {
  const zeroAt = timeZeroAt(weights);
  return criteria.map((c) => {
    const changed = Boolean(overrides && c.code in overrides && overrides[c.code] !== c.ok);
    const ok = changed ? overrides![c.code] : c.ok;
    if (ok === null) return null;
    if (ok) return 1;
    return !changed && c.timing ? timeCredit(c.timing.sec, c.timing.normSec, zeroAt) : 0;
  });
}

/** 0–100, or null when no check applies. */
export function computeScore(criteria: CriterionResult[], weights: Weights, overrides?: Overrides | null): number | null {
  const credits = checkCredits(criteria, weights, overrides);
  let weighted = 0;
  let total = 0;
  for (const group of Object.keys(WEIGHT_GROUPS) as WeightGroup[]) {
    const applicable = credits.filter((v, i): v is number => v !== null && criteria[i].group === group);
    const w = weights[group] ?? 0;
    if (!applicable.length || w <= 0) continue;
    weighted += (w * applicable.reduce((a, b) => a + b, 0)) / applicable.length;
    total += w;
  }
  if (!total) return null;
  const score = Math.round((weighted / total) * 100);
  const criticalFailed = applyOverrides(criteria, overrides).some((c) => c.critical && c.ok === false);
  return criticalFailed ? Math.min(score, CRITICAL_CAP) : score;
}

/**
 * «Балл за время» of a late time check the teacher left as it was, 0–100 — for the review line; null for any other
 * check (a passed one has all its points, a failed one none).
 */
export function timePoints(c: CriterionResult, weights: Pick<Weights, "timeZeroAt">, overrides?: Overrides | null): number | null {
  if (!c.timing || c.ok !== false || (overrides && c.code in overrides && overrides[c.code] !== c.ok)) return null;
  return Math.round(timeCredit(c.timing.sec, c.timing.normSec, timeZeroAt(weights)) * 100);
}

function mmss(sec: number): string {
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** «Балл за время — 49 %: после норматива 1:05 он снижается равномерно, к 2:10 — ноль». */
export function timePointsLine(c: CriterionResult, weights: Pick<Weights, "timeZeroAt">, overrides?: Overrides | null): string | null {
  const points = timePoints(c, weights, overrides);
  if (points == null || !c.timing) return null;
  const zeroAt = timeZeroAt(weights);
  const norm = mmss(c.timing.normSec);
  if (zeroAt <= 1) return `Балл за время — 0 %: после норматива ${norm} баллов за время нет`;
  return `Балл за время — ${points} %: после норматива ${norm} он снижается равномерно, к ${mmss(c.timing.normSec * zeroAt)} — ноль`;
}
