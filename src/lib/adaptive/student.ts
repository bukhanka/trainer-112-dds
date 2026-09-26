/**
 * «Мой прогноз» in the student's cabinet. Built only from the student's own attempts; the level shown
 * to the student counts confirmed attempts only, so a draft verdict never shows through.
 */
import { isOtherSessionPractice, type ViewerSession } from "@/lib/student/results";
import { forecastStudent, type StudentForecast } from "./forecast";
import { loadHistory, type HistoryAttempt } from "./history";
import { ratingsByRole, type RatingRole } from "./rating";

export type LevelView = { role: RatingRole; rating: number; difficulty: number; attempts: number };

export type StudentForecastView = { forecast: StudentForecast; levels: LevelView[] };

export function buildStudentForecast(history: HistoryAttempt[]): StudentForecastView {
  const ratings = ratingsByRole(history.filter((a) => a.reviewStatus !== "PENDING"));
  return {
    forecast: forecastStudent(history),
    levels: (["OP112", "DDS"] as const).map((role) => ({ role, rating: ratings[role].rating, difficulty: ratings[role].difficulty, attempts: ratings[role].attempts })),
  };
}

export async function getStudentForecast(studentId: string, viewer?: ViewerSession): Promise<StudentForecastView> {
  const history = (await loadHistory([studentId])).get(studentId) ?? [];
  return buildStudentForecast(history.filter((a) => !isOtherSessionPractice(a.lessonSettings, viewer)));
}
