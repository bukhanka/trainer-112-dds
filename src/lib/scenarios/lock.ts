import { db } from "@/lib/db";
import { isPractice, parseTeacherSettings } from "@/lib/lessons/form";

/**
 * A scenario a running class lesson may deal right now cannot be edited: assigned to a place, or
 * drawn by category when the place has no own tasks. Drafts are never dealt, so they stay editable.
 * Returns the lesson title or null.
 */
export async function scenarioLockedBy(scenario: { id: string; category: string; status: string }): Promise<string | null> {
  if (scenario.status !== "APPROVED") return null;
  const running = await db.lesson.findMany({
    where: { status: "RUNNING" },
    select: { title: true, settings: true, seats: { select: { scenarioIds: true } } },
  });
  for (const lesson of running) {
    if (isPractice(lesson.settings)) continue;
    const { categories } = parseTeacherSettings(lesson.settings);
    const uses = lesson.seats.some((s) =>
      s.scenarioIds.length ? s.scenarioIds.includes(scenario.id) : !categories.length || categories.includes(scenario.category),
    );
    if (uses) return lesson.title;
  }
  return null;
}
