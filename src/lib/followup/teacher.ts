/**
 * The route of a follow-up as the teacher sees it: both stages with their lessons, cases and attempts, the saved
 * observations with their basis, the next step and the history of the assignment.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { readCriteria, readOverrides } from "@/lib/review/draft";
import { approvedScenarios } from "./options";
import { seenSituations } from "./exposure";
import { pairProblem, type CaseOption } from "./pairing";
import { buildPool, caseKeys, caseOption, poolScenarioSelect } from "./pool";
import { goalEvidenceSchema, reviewDigest, SKILLS, type SkillKey } from "./skills";
import { followUpState, snapshot, type FollowUpState } from "./state";
import { followUpTarget, type FollowUpTarget } from "./student";

type LessonStatus = "DRAFT" | "RUNNING" | "FINISHED";

export type Observation = { observed: boolean; evidence: string; by: string; at: string; attemptId: string; current: boolean };
export type TeacherStage = {
  lessonId: string;
  lessonTitle: string;
  lessonStatus: LessonStatus;
  scenarioTitle: string | null;
  attemptId: string | null;
  checked: boolean;
  observation: Observation | null;
};
export type HistoryItem = { at: string; who: string | null; text: string; evidence?: string | null; lessonId?: string | null };
export type TeacherFollowUp = {
  id: string;
  title: string;
  studentName: string;
  sourceAttemptId: string;
  state: FollowUpState;
  status: string;
  next: string | null;
  target: FollowUpTarget | null;
  practice: TeacherStage;
  control: TeacherStage;
  cancelled: boolean;
  history: HistoryItem[];
  /** The student has met the control case since it was assigned: it must be replaced before the control starts. */
  controlSeen: boolean;
  /** New control cases the teacher can pick from (a missed control, or one the student has met). */
  controlChoices: CaseOption[] | null;
};

/** The state in the teacher's words, and the next step. */
export const TEACHER_STATE: Record<FollowUpState, { status: string; next: string | null }> = {
  cancelled: { status: "Назначение отменено", next: null },
  source_changed: { status: "Исходный разбор изменён", next: "Решение по исходной попытке поменялось после назначения: отмените старое назначение с причиной и при необходимости назначьте новое." },
  planned: { status: "Отработка ждёт запуска", next: "Начните занятие «Отработка» — ученик получит задание с подсказками." },
  practice: { status: "Идёт отработка", next: "Завершите занятие, когда ученик закончит задание." },
  practice_missed: { status: "Отработка завершена без попытки ученика", next: "Проверять нечего: ученик отсутствовал или пропустил вызов. «Повторить отработку» создаст для него новое занятие с тем же заданием; или отмените назначение с причиной." },
  review_practice: { status: "Попытка отработки ждёт вашей проверки", next: "Проверьте попытку отработки — после этого можно начинать контроль." },
  control_ready: { status: "Можно начинать контроль", next: "Начните занятие «Контроль»: новая ситуация без подсказок." },
  control: { status: "Идёт контроль", next: "Завершите занятие, когда ученик закончит задание." },
  control_missed: { status: "Контроль завершён без попытки ученика", next: "Проверять нечего: ученик отсутствовал или пропустил вызов. «Повторить контроль» создаст новое занятие; ситуацию, которую ученик уже слышал, замените на новую." },
  review_control: { status: "Попытка контроля ждёт вашей проверки", next: "Проверьте попытку контроля." },
  observe_control: { status: "Проверки цели на контроле пройдены — нужно ваше наблюдение", next: "Сверьте разговор и карточку контрольной попытки и отметьте, выполнил ли ученик действие. Без этого цель не засчитывается." },
  achieved: { status: "Цель выполнена на новой ситуации", next: null },
  not_achieved: { status: "Цель на контроле не выполнена", next: "Навык ещё требует отработки: назначьте новую отработку из разбора контрольной попытки." },
  insufficient: { status: "Недостаточно данных для вывода", next: "Нужные проверки цели на контроле не сработали: откройте попытку контроля и проверьте их." },
};

const include = {
  sourceAttempt: { include: { student: { select: { fullName: true } } } },
  practiceLesson: { include: { seats: true } },
  controlLesson: { include: { seats: true } },
  createdBy: { select: { fullName: true } },
} satisfies Prisma.FollowUpInclude;

type Row = Prisma.FollowUpGetPayload<{ include: typeof include }>;

function stageOf(row: Row, stage: "practice" | "control", attempts: { id: string; lessonId: string; scenarioId: string | null; reviewStatus: string; reviewedAt: Date | null; criteria: unknown; override: unknown; teacherComment: string | null }[],
  titles: Map<string, string>, people: Map<string, string>): TeacherStage {
  const snap = snapshot(row.sourceSnapshot);
  const lesson = stage === "practice" ? row.practiceLesson : row.controlLesson;
  const scenarioId = stage === "practice" ? snap.practiceScenarioId : snap.controlScenarioId;
  const attempt = attempts.find((a) => a.lessonId === lesson.id && (!scenarioId || a.scenarioId === scenarioId)) ?? null;
  const judged = goalEvidenceSchema.safeParse(stage === "practice" ? row.practiceJudgment : row.controlJudgment);
  const observation = judged.success ? {
    observed: judged.data.observed,
    evidence: judged.data.evidence,
    by: people.get(judged.data.reviewedById) ?? "преподаватель",
    at: formatDateTime(judged.data.reviewedAt),
    attemptId: judged.data.attemptId,
    // An observation of an attempt whose review has changed since is shown, but no longer counts.
    current: !!attempt && attempt.id === judged.data.attemptId && attempt.reviewedAt != null && reviewDigest({
      criteria: readCriteria(attempt.criteria), override: readOverrides(attempt.override), reviewedAt: attempt.reviewedAt, teacherComment: attempt.teacherComment,
    }) === judged.data.reviewDigest,
  } : null;
  return {
    lessonId: lesson.id,
    lessonTitle: lesson.title,
    lessonStatus: lesson.status as LessonStatus,
    scenarioTitle: scenarioId ? titles.get(scenarioId) ?? "сценарий удалён" : null,
    attemptId: attempt?.id ?? null,
    checked: Boolean(attempt && attempt.reviewStatus !== "PENDING"),
    observation,
  };
}

type Audit = { at: Date; action: string; actorId: string | null; entityId: string | null; before: unknown; after: unknown };
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const str = (v: unknown) => (typeof v === "string" ? v : null);

export function followUpHistory(row: Row, audits: Audit[], titles: Map<string, string>, people: Map<string, string>, target: FollowUpTarget | null): HistoryItem[] {
  const skill = row.skillKey as SkillKey;
  const items: (HistoryItem & { when: number })[] = [{
    when: row.createdAt.getTime(),
    at: formatDateTime(row.createdAt),
    who: row.createdBy.fullName,
    text: `Назначена отработка «${skill in SKILLS ? SKILLS[skill].title : row.skillKey}»${target ? ` по замечанию «${target.title}»` : ""}`,
  }];
  for (const a of audits.filter((x) => x.entityId === row.id)) {
    const after = obj(a.after);
    const before = obj(a.before);
    const who = a.actorId ? people.get(a.actorId) ?? null : null;
    const base = { when: a.at.getTime(), at: formatDateTime(a.at), who };
    if (a.action === "followup.observe") {
      const stage = after.stage === "practice" ? "отработке" : "контролю";
      const judged = goalEvidenceSchema.safeParse(after.stage === "practice" ? row.practiceJudgment : row.controlJudgment);
      // Observations saved before the basis went to the journal: the saved one of the same attempt.
      const evidence = str(after.evidence) ?? (judged.success && judged.data.attemptId === after.attemptId ? judged.data.evidence : null);
      items.push({ ...base, text: `Наблюдение по ${stage}: ${after.observed ? "выполнил" : "не выполнил"}`, evidence });
    } else if (a.action === "followup.repeat") {
      const practice = after.stage === "practice";
      items.push({ ...base, text: practice ? "Отработка назначена повторно: новое занятие" : "Контроль назначен повторно: новое занятие",
        lessonId: str(practice ? after.practiceLessonId : after.controlLessonId) });
      if (!practice && str(after.controlScenarioId) && after.controlScenarioId !== before.controlScenarioId) {
        items.push({ ...base, text: `Контрольная ситуация заменена: «${titles.get(String(before.controlScenarioId)) ?? "—"}» → «${titles.get(String(after.controlScenarioId)) ?? "—"}»` });
      }
    } else if (a.action === "followup.replace_control") {
      items.push({ ...base, text: `Контрольная ситуация заменена: «${titles.get(String(before.controlScenarioId)) ?? "—"}» → «${titles.get(String(after.controlScenarioId)) ?? "—"}»` });
    } else if (a.action === "followup.cancel") {
      items.push({ ...base, text: "Назначение отменено", evidence: str(after.reason) ?? row.cancellationReason });
    }
  }
  return items.sort((x, y) => x.when - y.when).map((i) => ({ at: i.at, who: i.who, text: i.text, evidence: i.evidence ?? null, lessonId: i.lessonId ?? null }));
}

/** Cards of the teacher's follow-ups; `details` adds the checks that need the student's history (the source attempt page). */
export async function teacherFollowUps(where: Prisma.FollowUpWhereInput, details = false): Promise<TeacherFollowUp[]> {
  const rows = await db.followUp.findMany({ where, orderBy: { createdAt: "asc" }, include });
  if (!rows.length) return [];
  const studentIds = [...new Set(rows.map((r) => r.sourceAttempt.studentId))];
  const lessonIds = [...new Set(rows.flatMap((r) => [r.practiceLessonId, r.controlLessonId]))];
  const [attempts, audits] = await Promise.all([
    db.attempt.findMany({ where: { studentId: { in: studentIds }, lessonId: { in: lessonIds } }, orderBy: { createdAt: "desc" },
      select: { id: true, lessonId: true, studentId: true, scenarioId: true, reviewStatus: true, reviewedAt: true, criteria: true, override: true, teacherComment: true } }),
    db.auditLog.findMany({ where: { entity: "FollowUp", entityId: { in: rows.map((r) => r.id) } }, orderBy: { at: "asc" },
      select: { at: true, action: true, actorId: true, entityId: true, before: true, after: true } }),
  ]);
  const scenarioIds = new Set<string>();
  for (const r of rows) {
    const snap = snapshot(r.sourceSnapshot);
    for (const id of [snap.practiceScenarioId, snap.controlScenarioId]) if (id) scenarioIds.add(id);
  }
  for (const a of audits) for (const v of [obj(a.before).controlScenarioId, obj(a.after).controlScenarioId]) if (typeof v === "string") scenarioIds.add(v);
  const personIds = new Set<string>();
  for (const r of rows) for (const j of [r.practiceJudgment, r.controlJudgment]) {
    const p = goalEvidenceSchema.safeParse(j);
    if (p.success) personIds.add(p.data.reviewedById);
  }
  for (const a of audits) if (a.actorId) personIds.add(a.actorId);
  const [scenarios, people] = await Promise.all([
    db.scenario.findMany({ where: { id: { in: [...scenarioIds] } }, select: { id: true, title: true } }),
    db.user.findMany({ where: { id: { in: [...personIds] } }, select: { id: true, fullName: true } }),
  ]);
  const titles = new Map(scenarios.map((s) => [s.id, s.title]));
  const names = new Map(people.map((p) => [p.id, p.fullName]));

  const cards = await Promise.all(rows.map(async (row) => {
    const state = await followUpState(db, row);
    const own = attempts.filter((a) => a.studentId === row.sourceAttempt.studentId);
    const target = followUpTarget(row.skillKey, row.sourceSnapshot);
    const skill = row.skillKey as SkillKey;
    return {
      id: row.id,
      title: skill in SKILLS ? SKILLS[skill].title : "Отработка навыка",
      studentName: row.sourceAttempt.student.fullName,
      sourceAttemptId: row.sourceAttemptId,
      state,
      status: TEACHER_STATE[state].status,
      next: TEACHER_STATE[state].next,
      target,
      practice: stageOf(row, "practice", own, titles, names),
      control: stageOf(row, "control", own, titles, names),
      cancelled: state === "cancelled",
      history: followUpHistory(row, audits, titles, names, target),
      controlSeen: false,
      controlChoices: null as CaseOption[] | null,
    };
  }));
  if (!details) return cards;
  // Only a control that is still to come can need another case: a missed one, or one the student met elsewhere.
  const open = cards.filter((c) => c.state === "control_missed" || c.state === "control_ready");
  if (!open.length) return cards;
  const met = await seenSituations(db, [...new Set(open.map((c) => rows.find((r) => r.id === c.id)!.sourceAttempt.studentId))]);
  const approved = await approvedScenarios();
  for (const card of open) {
    const row = rows.find((r) => r.id === card.id)!;
    const snap = snapshot(row.sourceSnapshot);
    const skill = row.skillKey as SkillKey;
    if (!(skill in SKILLS)) continue;
    const studentId = row.sourceAttempt.studentId;
    // A finished control lesson in which the case rang does count: the student has heard it.
    const seen = card.state === "control_ready"
      ? (await seenSituations(db, [studentId], [row.controlLessonId])).get(studentId) ?? new Set<string>()
      : met.get(studentId) ?? new Set<string>();
    const [source, service, current, practice] = await Promise.all([
      row.sourceAttempt.scenarioId ? db.scenario.findUnique({ where: { id: row.sourceAttempt.scenarioId }, select: poolScenarioSelect }) : null,
      SKILLS[skill].role === "DDS" && snap.serviceId ? db.service.findUnique({ where: { id: snap.serviceId } }) : null,
      snap.controlScenarioId ? db.scenario.findUnique({ where: { id: snap.controlScenarioId }, select: poolScenarioSelect }) : null,
      snap.practiceScenarioId ? db.scenario.findUnique({ where: { id: snap.practiceScenarioId }, select: poolScenarioSelect }) : null,
    ]);
    card.controlSeen = !!current && caseKeys(current).some((k) => seen.has(k));
    if (card.state === "control_ready" && !card.controlSeen) continue;
    const ctx = { source, service, seen };
    const pool = buildPool(skill, approved, ctx);
    const practiceOption = practice ? caseOption(skill, practice, ctx, "practice") : null;
    card.controlChoices = pool.control.filter((c) => !practiceOption || pairProblem(SKILLS[skill].role, practiceOption, c) === null);
  }
  return cards;
}
