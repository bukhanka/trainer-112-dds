import { db } from "@/lib/db";
import { isPractice, parseTeacherSettings } from "@/lib/lessons/form";
import { inLocation } from "./location";
import { scenarioPlace } from "./place";

/**
 * A scenario a running class lesson may deal right now cannot be edited: assigned to a place, or
 * drawn by category (and location) when the place has no own tasks. Drafts are never dealt, so they stay editable.
 * Returns the lesson title or null.
 */
export async function scenarioLockedBy(scenario: { id: string; category: string; status: string; truth?: unknown }): Promise<string | null> {
  if (scenario.status !== "APPROVED") return null;
  const running = await db.lesson.findMany({
    where: { status: "RUNNING" },
    select: { title: true, settings: true, seats: { select: { scenarioIds: true } } },
  });
  for (const lesson of running) {
    if (isPractice(lesson.settings)) continue;
    const { categories, location } = parseTeacherSettings(lesson.settings);
    // Without the address at hand the scenario counts as being in the lesson's location.
    const here = !location || scenario.truth === undefined || inLocation(scenarioPlace(scenario.truth), location);
    const uses = lesson.seats.some((s) =>
      s.scenarioIds.length ? s.scenarioIds.includes(scenario.id) : here && (!categories.length || categories.includes(scenario.category)),
    );
    if (uses) return lesson.title;
  }
  return null;
}
