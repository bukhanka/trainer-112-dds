/**
 * Forecasts for the teacher: the next lesson of every student of the teacher's groups and who is at
 * risk. Only attempts of the teacher's own lessons are read — the same rule as in the rest of the
 * cabinet (an administrator sees everything).
 */
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import type { ReportInput } from "@/lib/reports/lesson";
import { attemptScope, groupScope, lessonScope } from "@/lib/teacher/access";
import { forecastStudent, accuracy, type Accuracy, type Risk, type ScoreForecast, type TimeForecast } from "./forecast";
import { loadHistory, type HistoryAttempt } from "./history";
import { ratingsByRole, type RatingRole } from "./rating";
import { buildLessonForecast, type LessonForecast, type SnapshotRow } from "./snapshot";

export type GroupForecastRow = {
  studentId: string;
  name: string;
  groups: string[];
  score: ScoreForecast | null;
  time: Record<RatingRole, TimeForecast | null>;
  levels: Record<RatingRole, { rating: number; difficulty: number; attempts: number }>;
  risk: Risk;
};

export type GroupForecast = { rows: GroupForecastRow[]; atRisk: number; withForecast: number };

export function buildGroupForecast(students: { id: string; name: string; groups: string[] }[], history: Map<string, HistoryAttempt[]>): GroupForecast {
  const rows = students.map((st) => {
    const list = history.get(st.id) ?? [];
    const f = forecastStudent(list);
    const ratings = ratingsByRole(list);
    const level = (role: RatingRole) => ({ rating: ratings[role].rating, difficulty: ratings[role].difficulty, attempts: ratings[role].attempts });
    return { studentId: st.id, name: st.name, groups: st.groups, score: f.score, time: f.time, levels: { OP112: level("OP112"), DDS: level("DDS") }, risk: f.risk };
  });
  // At risk first, then the weakest forecast; students without history last.
  rows.sort(
    (a, b) =>
      Number(b.risk.atRisk) - Number(a.risk.atRisk) ||
      Number(!a.score) - Number(!b.score) ||
      (a.score?.expected ?? 0) - (b.score?.expected ?? 0) ||
      a.name.localeCompare(b.name, "ru"),
  );
  return { rows, atRisk: rows.filter((r) => r.risk.atRisk).length, withForecast: rows.filter((r) => r.score).length };
}

export async function getGroupForecast(user: SessionUser): Promise<GroupForecast> {
  const groups = await db.group.findMany({
    where: groupScope(user),
    orderBy: { name: "asc" },
    select: { name: true, members: { select: { user: { select: { id: true, fullName: true, role: true } } } } },
  });
  const students = new Map<string, { id: string; name: string; groups: string[] }>();
  for (const g of groups) {
    for (const { user: u } of g.members) {
      if (u.role !== "STUDENT") continue;
      const st = students.get(u.id) ?? { id: u.id, name: u.fullName, groups: [] };
      st.groups.push(g.name);
      students.set(u.id, st);
    }
  }
  const history = await loadHistory([...students.keys()], { scope: attemptScope(user) });
  return buildGroupForecast([...students.values()], history);
}

// ─── forecast against the fact over the teacher's lessons ────────────────────

export type ForecastPoint = { key: string; lessonId: string; lesson: string; name: string; expected: number; low: number; high: number; fact: number; inside: boolean };

export type LessonAccuracy = { lessonId: string; title: string; startedAt: Date | null; accuracy: Accuracy; snapshots: number };

export type ForecastHistory = { overall: Accuracy; lessons: LessonAccuracy[]; points: ForecastPoint[] };

type SnapshotWithLesson = SnapshotRow & { lessonId: string; lesson: { id: string; title: string; startedAt: Date | null }; student: { fullName: string } };

/** Pure: every saved forecast with its fact, per lesson and overall. */
export function buildForecastHistory(snapshots: SnapshotWithLesson[], attempts: { lessonId: string; studentId: string; score: number | null; reviewStatus: string }[]): ForecastHistory {
  const facts = new Map<string, number[]>();
  for (const a of attempts) {
    if (a.reviewStatus === "PENDING" || a.score == null) continue;
    const key = `${a.lessonId}:${a.studentId}`;
    facts.set(key, [...(facts.get(key) ?? []), a.score]);
  }
  const factOf = (lessonId: string, studentId: string) => {
    const list = facts.get(`${lessonId}:${studentId}`);
    return list?.length ? Math.round((list.reduce((x, y) => x + y, 0) / list.length) * 10) / 10 : null;
  };
  const pairs = snapshots.map((s) => ({ s, fact: factOf(s.lessonId, s.studentId) }));
  const toRow = ({ s, fact }: (typeof pairs)[number]) => ({ expected: s.expected, low: s.low, high: s.high, baseline: s.baseline, fact });

  const byLesson = new Map<string, typeof pairs>();
  for (const p of pairs) byLesson.set(p.s.lessonId, [...(byLesson.get(p.s.lessonId) ?? []), p]);
  const lessons = [...byLesson.values()]
    .map((list) => ({ lessonId: list[0].s.lesson.id, title: list[0].s.lesson.title, startedAt: list[0].s.lesson.startedAt, accuracy: accuracy(list.map(toRow)), snapshots: list.length }))
    .sort((a, b) => (b.startedAt?.getTime() ?? 0) - (a.startedAt?.getTime() ?? 0));

  const points = pairs.flatMap(({ s, fact }) =>
    s.expected != null && s.low != null && s.high != null && fact != null
      ? [{ key: `${s.lessonId}:${s.studentId}`, lessonId: s.lessonId, lesson: s.lesson.title, name: s.student.fullName, expected: s.expected, low: s.low, high: s.high, fact, inside: fact >= s.low && fact <= s.high }]
      : [],
  );
  return { overall: accuracy(pairs.map(toRow)), lessons, points };
}

export async function getForecastHistory(user: SessionUser): Promise<ForecastHistory> {
  const snapshots = await db.forecastSnapshot.findMany({
    where: { lesson: lessonScope(user) },
    include: { lesson: { select: { id: true, title: true, startedAt: true } }, student: { select: { fullName: true } } },
  });
  const lessonIds = [...new Set(snapshots.map((s) => s.lessonId))];
  const attempts = lessonIds.length
    ? await db.attempt.findMany({ where: { lessonId: { in: lessonIds }, reviewStatus: { not: "PENDING" } }, select: { lessonId: true, studentId: true, score: true, reviewStatus: true } })
    : [];
  return buildForecastHistory(snapshots, attempts);
}

/** «Прогноз ↔ факт» of one lesson; the caller has checked access to the lesson. */
export async function lessonForecast(lessonId: string, input: ReportInput): Promise<LessonForecast> {
  const snapshots = await db.forecastSnapshot.findMany({ where: { lessonId } });
  return buildLessonForecast({
    seats: input.seats.map((s) => ({ studentId: s.studentId, name: s.studentName, seat: s.label, role: s.role })),
    snapshots,
    attempts: input.attempts,
  });
}
