import { db } from "@/lib/db";
import { readCriteria } from "@/lib/review/draft";
import { errorTitle } from "@/lib/scoring/errors";
import { goalErrors, SKILLS, type SkillKey } from "./skills";
import { followUpState, snapshot, type FollowUpState } from "./state";

/** What the student reads about a stage: where the route is, never what the next case is. */
export const STUDENT_STATE_TEXT: Record<FollowUpState, string> = {
  cancelled: "Назначение отменено",
  source_changed: "Исходный разбор изменён — преподаватель проверит назначение",
  planned: "Отработка ждёт начала преподавателем",
  practice: "Идёт отработка с подсказками",
  practice_missed: "Отработка не выполнена — преподаватель назначит её снова",
  review_practice: "Отработка ждёт проверки",
  control_ready: "Контроль ждёт начала преподавателем",
  control: "Идёт контроль без подсказок",
  control_missed: "Контроль не выполнен — преподаватель назначит его снова",
  review_control: "Контроль ждёт проверки",
  observe_control: "Контроль ждёт проверки",
  achieved: "Цель выполнена на новой ситуации",
  not_achieved: "Навык ещё требует отработки",
  insufficient: "Пока недостаточно данных для вывода",
};

/** The error the follow-up is for, from the snapshot the teacher assigned it on; the student's own check texts. */
export type FollowUpTarget = { title: string; critical: boolean; evidence: string | null; expected: string | null; advice: string };

export function followUpTarget(skillKey: string, rawSnapshot: unknown): FollowUpTarget | null {
  if (!(skillKey in SKILLS)) return null;
  const skill = skillKey as SkillKey;
  const errors = goalErrors(skill, readCriteria(snapshot(rawSnapshot).criteria));
  const main = errors.find((c) => c.critical) ?? errors[0];
  if (!main) return null;
  return {
    title: errorTitle(main),
    critical: Boolean(main.critical),
    evidence: main.evidence?.trim() ? main.evidence.trim().slice(0, 500) : null,
    expected: main.expected?.trim() ? main.expected.trim().slice(0, 300) : null,
    advice: SKILLS[skill].advice,
  };
}

/** Whitelist for the learner. Never return control scenario names, personae, references or hidden answers. */
export async function studentFollowUps(studentId: string, sourceAttemptId?: string) {
  const rows = await db.followUp.findMany({
    where: { sourceAttempt: { studentId, ...(sourceAttemptId ? { id: sourceAttemptId } : {}) } },
    orderBy: { createdAt: "desc" }, take: 30,
    include: { sourceAttempt: true, practiceLesson: { include: { seats: true } }, controlLesson: { include: { seats: true } } },
  });
  return Promise.all(rows.map(async (row) => {
    const state = await followUpState(db, row);
    const key = row.skillKey as SkillKey;
    return {
      id: row.id,
      sourceAttemptId: row.sourceAttemptId,
      title: key in SKILLS ? SKILLS[key].title : "Отработка навыка",
      state,
      status: STUDENT_STATE_TEXT[state],
      practiceLessonId: row.practiceLessonId,
      controlLessonId: row.controlLessonId,
      target: followUpTarget(row.skillKey, row.sourceSnapshot),
    };
  }));
}
