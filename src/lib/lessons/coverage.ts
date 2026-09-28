/**
 * Will every place of a lesson get cards? A place without tasks marked by hand draws scenarios from the
 * lesson's categories and location. A category without approved scenarios only narrows the choice —
 * the teacher is warned; when nothing is left at all, the lesson must not start, or a ДДС place would
 * sit silently with «Нет одобренных сценариев».
 *
 * Pure: the lesson form runs it in the browser, the lesson page and the start of the lesson on the server.
 */
import { inLocation, placeLabel, type LocationFilter } from "@/lib/scenarios/location";

/** A scenario a lesson may deal. approved = false: only the caller is approved — it plays at 112 places only. */
/**
 * approved — the scenario is approved (counted in the form as in «Сгенерировать по категории»);
 * dds — a ДДС place can deal it (approved and has a card for the ДДС place; tasks «только для места 112» have none);
 * op112 — a 112 place can deal it (not a variant with an error in the card, which plays at the ДДС place only).
 * Not approved: only the caller is approved — it plays at 112 places only.
 */
export type CoverageScenario = { id: string; category: string; okrug: string | null; district: string | null; approved: boolean; dds?: boolean; op112?: boolean };

const forDds = (s: CoverageScenario) => s.dds ?? s.approved;
const for112 = (s: CoverageScenario) => s.op112 ?? true;

export type CoverageSettings = {
  categories: string[];
  location?: LocationFilter | null;
  cardSource?: "generated" | "students" | "mixed";
};

export type CoverageSeat = { role: "OP112" | "DDS"; scenarioIds: string[] };

export type CategoryCount = { name: string; approved: number; here: number };

export type Coverage = {
  /** Approved scenarios per category: in total and in the chosen location. */
  counts: CategoryCount[];
  /** Chosen categories that give nothing (in the chosen location). */
  empty: string[];
  /** Scenarios left for places without tasks: ДДС places take approved ones, 112 places also those with an approved caller, but no card-error variants. */
  pool: { dds: number; op112: number };
  /** Some places draw from categories (no tasks by hand). */
  drawing: boolean;
  /** Why the lesson cannot start; null when every place gets cards. */
  blocked: string | null;
  /** The smallest choice a place without tasks draws from (ДДС: approved, 112: also approved callers); null — none draws. */
  few: number | null;
  /** Empty categories that have tasks, but only for the 112 place. */
  only112: string[];
};

const quoted = (list: string[]) => list.map((c) => `«${c}»`).join(", ");

export function lessonCoverage(scenarios: CoverageScenario[], settings: CoverageSettings, seats: CoverageSeat[]): Coverage {
  const location = settings.location ?? null;
  const chosen = settings.categories;
  const inCategories = (s: CoverageScenario) => !chosen.length || chosen.includes(s.category);

  const names = [...new Set([...scenarios.filter((s) => s.approved).map((s) => s.category), ...chosen])].sort((a, b) => a.localeCompare(b, "ru"));
  const counts = names.map((name) => {
    const approved = scenarios.filter((s) => s.approved && s.category === name);
    return { name, approved: approved.length, here: approved.filter((s) => inLocation(s, location)).length };
  });
  const usable = scenarios.filter((s) => inCategories(s) && inLocation(s, location));
  const pool = { dds: usable.filter(forDds).length, op112: usable.filter(for112).length };

  const drawingSeats = seats.filter((s) => !s.scenarioIds.length);
  const ddsDraw = settings.cardSource !== "students" && drawingSeats.some((s) => s.role === "DDS");
  const opDraw = drawingSeats.some((s) => s.role === "OP112");
  const drawing = ddsDraw || opDraw;

  // A category is empty for the places that draw: ДДС places need approved scenarios with a ДДС card,
  // 112 places also play tasks for the 112 place only and drafts whose caller is approved.
  const gives = (c: string) => usable.some((s) => s.category === c && (!ddsDraw || forDds(s)));
  const empty = chosen.filter((c) => !gives(c));
  // Of those, the categories that do have tasks — only for the 112 place.
  const only112 = empty.filter((c) => usable.some((s) => s.category === c && s.approved));

  let blocked: string | null = null;
  if ((ddsDraw && !pool.dds) || (opDraw && !pool.op112)) {
    const where = [chosen.length ? `в ${chosen.length === 1 ? "категории" : "категориях"} ${quoted(chosen)}` : "", location ? `в локации «${placeLabel(location)}»` : ""]
      .filter(Boolean)
      .join(" ");
    const why = ddsDraw && !pool.dds && usable.some((s) => s.approved) ? "только задания для места 112, для мест ДДС сценариев нет" : "нет утверждённых сценариев";
    blocked =
      `Местам без заданий нечего раздать: ${where || "в библиотеке"} ${why}. ` +
      "Утвердите сценарии в разделе «Сценарии», выберите другие категории или локацию либо отметьте задания местам вручную.";
  }
  const sizes = [...(ddsDraw ? [pool.dds] : []), ...(opDraw ? [pool.op112] : [])];
  return { counts, empty, only112, pool, drawing, blocked, few: sizes.length ? Math.min(...sizes) : null };
}

/** Fewer scenarios than this for the places without tasks — the cards will come round again and again. */
export const FEW_SCENARIOS = 5;

/** Warnings for the teacher before the start: a chosen category that gives nothing only narrows the choice. */
export function coverageWarnings(c: Coverage, settings: CoverageSettings): string[] {
  if (!c.drawing || c.blocked) return [];
  const where = settings.location ? ` в локации «${placeLabel(settings.location)}»` : "";
  const out = c.empty.map((name) =>
    c.only112.includes(name)
      ? `В категории «${name}» только задания для места 112${where} — места ДДС получат карточки только из других категорий.`
      : `В категории «${name}» нет утверждённых сценариев${where} — места получат карточки только из других категорий.`,
  );
  const few = c.few;
  if (few !== null && few < FEW_SCENARIOS) {
    out.push(
      `Карточки будут повторяться: местам без заданий доступно ${few} ${few === 1 ? "сценарий" : few < 5 ? "сценария" : "сценариев"}. ` +
        "Добавьте категории, снимите ограничение локации или утвердите ещё сценарии.",
    );
  }
  return out;
}
