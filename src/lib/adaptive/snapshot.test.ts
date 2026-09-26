import { describe, expect, it } from "vitest";
import type { HistoryAttempt } from "./history";
import { computeRating, RATING } from "./rating";
import { buildLessonForecast, snapshotRows, type SnapshotRow } from "./snapshot";
import { buildForecastHistory } from "./teacher";

const day = (d: number, h = 7) => new Date(Date.UTC(2026, 8, d, h));

function past(id: string, lesson: number, score: number, over: Partial<HistoryAttempt> = {}): HistoryAttempt {
  return {
    id,
    studentId: "ivanov",
    lessonId: `l${lesson}`,
    lessonTitle: `Занятие ${lesson}`,
    lessonStart: day(lesson),
    lessonSettings: {},
    kind: "DDS",
    score,
    reviewStatus: "CONFIRMED",
    createdAt: day(lesson, 8),
    reviewedAt: day(lesson, 12),
    difficulty: 4,
    timeSec: 22,
    normSec: 30,
    ...over,
  };
}

describe("snapshot at the start of a lesson", () => {
  const start = day(20);
  const history = new Map<string, HistoryAttempt[]>([
    [
      "ivanov",
      [
        past("a1", 10, 60),
        past("a2", 14, 70),
        past("a3", 17, 76),
        // Still a draft at the start: confirmed an hour later.
        past("a4", 19, 20, { reviewedAt: day(20, 8) }),
        // The lesson itself and a later one: after the start.
        past("a5", 20, 95, { createdAt: day(20, 8) }),
      ],
    ],
    ["newbie", []],
  ]);
  const rows = snapshotRows({
    lessonId: "l20",
    settings: { ackSec: 25, typingSec: 70 },
    seats: [
      { studentId: "ivanov", role: "DDS" },
      { studentId: "newbie", role: "OP112" },
    ],
    history,
    at: start,
  });

  it("keeps only what was known and confirmed at the start", () => {
    const iv = rows[0];
    expect(iv.lessons).toBe(3);
    expect(iv.expected).toBeGreaterThan(70); // rising 60 → 70 → 76
    expect(iv.expected).toBeLessThan(90);
    expect(iv.low).toBeLessThan(iv.expected!);
    expect(iv.high).toBeGreaterThan(iv.expected!);
    expect(iv.baseline).toBeCloseTo((60 + 70 + 76) / 3, 1);
    expect(iv.normSec).toBe(25); // the lesson's own norm
    expect(iv.pOnTime).toBeGreaterThan(0.5);
    // The level as it stood then: the late-confirmed attempt counts as the draft it was.
    const list = history.get("ivanov")!;
    const asThen = [...list.slice(0, 3), { ...list[3], reviewStatus: "PENDING" as const }];
    expect(iv.rating).toBe(computeRating("DDS", asThen).rating);
    expect(iv.rating).not.toBe(computeRating("DDS", list.slice(0, 4)).rating);
    expect(iv.createdAt).toEqual(start);
  });

  it("saves a newcomer without a forecast but with the starting level", () => {
    expect(rows[1]).toMatchObject({ studentId: "newbie", role: "OP112", expected: null, low: null, lessons: 0, pOnTime: null, normSec: 70, rating: RATING.start, difficulty: 3 });
  });
});

const snap = (studentId: string, expected: number | null, over: Partial<SnapshotRow> = {}): SnapshotRow => ({
  studentId,
  role: "DDS",
  expected,
  low: expected == null ? null : expected - 10,
  high: expected == null ? null : expected + 10,
  baseline: expected == null ? null : expected - 3,
  trend: 0,
  lessons: expected == null ? 0 : 3,
  pOnTime: 0.8,
  normSec: 30,
  rating: 1300,
  difficulty: 4,
  ...over,
});

describe("forecast against the fact of a lesson", () => {
  const data = buildLessonForecast({
    seats: [
      { studentId: "a", name: "Иванов", seat: "Место 1", role: "DDS" },
      { studentId: "b", name: "Петрова", seat: "Место 2", role: "DDS" },
      { studentId: "c", name: "Сидоров", seat: "Место 3", role: "DDS" },
      { studentId: "d", name: "Новиков", seat: "Место 4", role: "DDS" },
    ],
    snapshots: [snap("a", 70), snap("b", 60), snap("c", 80), snap("d", null)],
    attempts: [
      { studentId: "a", reviewStatus: "CONFIRMED", score: 78, timeSec: 20 },
      { studentId: "a", reviewStatus: "OVERRIDDEN", score: 72, timeSec: 40 },
      { studentId: "b", reviewStatus: "CONFIRMED", score: 35, timeSec: 25 },
      { studentId: "c", reviewStatus: "PENDING", score: 90 },
      { studentId: "d", reviewStatus: "CONFIRMED", score: 50 },
    ],
  });

  it("takes the average confirmed score as the fact and compares it with the saved forecast", () => {
    const [a, b, c, d] = data.rows;
    expect(a).toMatchObject({ fact: 75, error: 5, inside: true, confirmed: 2, onTime: { met: 1, total: 2 } });
    expect(b).toMatchObject({ fact: 35, error: -25, inside: false });
    expect(c).toMatchObject({ fact: null, error: null, pending: 1 }); // a draft is not a fact
    expect(d).toMatchObject({ fact: 50, error: null }); // no forecast for a newcomer
  });

  it("counts the accuracy only where both exist", () => {
    expect(data.accuracy).toEqual({ n: 2, mae: 15, baselineMae: 15, inside: 1, bias: -10 });
    expect(data.snapshots).toBe(4);
  });
});

describe("forecast against the fact over the lessons", () => {
  const lesson = (id: string, d: number) => ({ id, title: `Занятие ${id}`, startedAt: day(d) });
  const withLesson = (s: SnapshotRow, lessonId: string, d: number, name: string) => ({ ...s, lessonId, lesson: lesson(lessonId, d), student: { fullName: name } });
  const history = buildForecastHistory(
    [withLesson(snap("a", 70), "l1", 10, "Иванов"), withLesson(snap("b", 50), "l1", 10, "Петрова"), withLesson(snap("a", 74), "l2", 12, "Иванов"), withLesson(snap("b", null), "l2", 12, "Петрова")],
    [
      { lessonId: "l1", studentId: "a", score: 80, reviewStatus: "CONFIRMED" },
      { lessonId: "l1", studentId: "b", score: 45, reviewStatus: "CONFIRMED" },
      { lessonId: "l2", studentId: "a", score: 60, reviewStatus: "PENDING" },
      { lessonId: "l2", studentId: "b", score: 66, reviewStatus: "CONFIRMED" },
    ],
  );

  it("pairs each saved forecast with its own lesson's fact", () => {
    expect(history.overall).toMatchObject({ n: 2, mae: 7.5, inside: 2 });
    expect(history.points.map((p) => [p.key, p.expected, p.fact])).toEqual([
      ["l1:a", 70, 80],
      ["l1:b", 50, 45],
    ]);
  });

  it("lists lessons newest first with their own accuracy", () => {
    expect(history.lessons.map((l) => [l.lessonId, l.accuracy.n, l.snapshots])).toEqual([
      ["l2", 0, 2],
      ["l1", 2, 2],
    ]);
  });
});
