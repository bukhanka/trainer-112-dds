/** The answer to «Утвердить списком» in words (shared by the route's tests and the list; no dependencies, for the browser). */

export type BulkSkips = { decided: number; edited: number; critical: number; missing: number };

/** «Подтверждено: 9. Решите по одной: 2 — с критичной ошибкой. Пропущены: уже решены — 1.» */
export function bulkResultText(confirmed: number, s: BulkSkips): string {
  const look = [s.critical && `${s.critical} — с критичной ошибкой`, s.edited && `${s.edited} — с правками или комментарием преподавателя`].filter(Boolean);
  const other = [s.decided && `уже решены — ${s.decided}`, s.missing && `не найдены — ${s.missing} (обновите страницу)`].filter(Boolean);
  return [`Подтверждено: ${confirmed}.`, look.length ? `Решите по одной: ${look.join(", ")}.` : "", other.length ? `Пропущены: ${other.join(", ")}.` : ""]
    .filter(Boolean)
    .join(" ");
}
