import { describe, expect, it } from "vitest";
import { lessonSettingsSchema } from "@/lib/lessons/settings";
import { computeRating, RATING, type RatingAttempt } from "./rating";
import { lessonLevels } from "./report";

const start = new Date("2026-09-25T07:00:00Z");
const at = (min: number) => new Date(start.getTime() + min * 60_000);

function a(id: string, lessonId: string, minutes: number, score: number, difficulty: number, kind: "OP112" | "DDS" = "DDS"): RatingAttempt {
  return { id, lessonId, kind, score, difficulty, reviewStatus: "CONFIRMED", createdAt: at(minutes) };
}

describe("levels in the lesson report", () => {
  const history = new Map<string, RatingAttempt[]>([
    [
      "ivanov",
      [
        a("old1", "l0", -3000, 90, 3),
        a("old2", "l0", -2990, 85, 3),
        a("now1", "l1", 10, 95, 5),
        a("now2", "l1", 20, 80, 6),
        // A later lesson must not leak into this lesson's «after».
        a("later", "l2", 5000, 10, 6),
        // Another role does not count for a ДДС place.
        a("op", "l1", 15, 5, 3, "OP112"),
      ],
    ],
    ["petrova", [a("p1", "l1", 12, 40, 3)]],
  ]);
  const rows = lessonLevels({
    lessonId: "l1",
    start,
    seats: [
      { studentId: "ivanov", name: "Иванов", seat: "Место 1", role: "DDS" },
      { studentId: "petrova", name: "Петрова", seat: "Место 2", role: "DDS" },
    ],
    attempts: history,
  });

  it("shows the level before and after the lesson in the role of the place", () => {
    const iv = rows[0];
    const list = history.get("ivanov")!;
    expect(iv.before).toBe(computeRating("DDS", list.filter((x) => x.lessonId === "l0")).rating);
    expect(iv.after).toBe(computeRating("DDS", list.filter((x) => x.lessonId !== "l2")).rating);
    expect(iv.delta).toBe(iv.after - iv.before);
    expect(iv.delta).toBeGreaterThan(0);
    expect(iv.newcomer).toBe(false);
    expect(iv.lessonAttempts).toBe(2);
    expect(iv.tasks).toEqual({ min: 5, max: 6, mean: 5.5 });
  });

  it("marks a newcomer and moves a weak first lesson down", () => {
    const pe = rows[1];
    expect(pe).toMatchObject({ before: RATING.start, newcomer: true, lessonAttempts: 1 });
    expect(pe.after).toBeLessThan(RATING.start);
  });
});

describe("adaptive setting", () => {
  it("is on by default in a class lesson and in practice without a teacher", () => {
    expect(lessonSettingsSchema.parse({}).adaptive).toBe(true);
    expect(lessonSettingsSchema.parse({ practice: true, cardSource: "generated" }).adaptive).toBe(true);
    expect(lessonSettingsSchema.parse({ adaptive: false }).adaptive).toBe(false);
  });
});
