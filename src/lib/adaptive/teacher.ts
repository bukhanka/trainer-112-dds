/**
 * Forecasts for the teacher: the next lesson of every student of the teacher's groups and who is at
 * risk. Only attempts of the teacher's own lessons are read — the same rule as in the rest of the
 * cabinet (an administrator sees everything).
 */
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { attemptScope, groupScope } from "@/lib/teacher/access";
import { forecastStudent, type Risk, type ScoreForecast, type TimeForecast } from "./forecast";
import { loadHistory, type HistoryAttempt } from "./history";
import { ratingsByRole, type RatingRole } from "./rating";

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
