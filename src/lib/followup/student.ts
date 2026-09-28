import { db } from "@/lib/db";
import { SKILLS, type SkillKey } from "./skills";
import { followUpState } from "./state";

const STATE_TEXT = {
  cancelled: "Назначение отменено",
  source_changed: "Исходный разбор изменён — преподаватель проверит назначение",
  planned: "Отработка ждёт начала преподавателем",
  practice: "Идёт отработка с подсказками",
  review_practice: "Отработка ждёт проверки",
  control_ready: "Контроль ждёт начала преподавателем",
  control: "Идёт контроль без подсказок",
  review_control: "Контроль ждёт проверки",
  achieved: "Цель выполнена на новой ситуации",
  not_achieved: "Навык ещё требует отработки",
  insufficient: "Пока недостаточно данных для вывода",
} as const;

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
      status: STATE_TEXT[state],
      practiceLessonId: row.practiceLessonId,
      controlLessonId: row.controlLessonId,
    };
  }));
}
