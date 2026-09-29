import { Prisma, type SeatRole } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { readCriteria, readOverrides } from "@/lib/review/draft";
import { getActiveWeights } from "@/lib/scoring/weights";
import { lessonSettingsSchema } from "@/lib/lessons/settings";
import { attemptScope, auditInTx } from "@/lib/teacher/access";
import type { SessionUser } from "@/lib/auth/session";
import { seenSituations } from "./exposure";
import { pairProblem } from "./pairing";
import { caseOption, poolScenarioSelect, SEEN, unsuitable, type PoolContext, type PoolScenario } from "./pool";
import { effectiveChecks, reviewDigest, scenarioDigest, SKILLS, skillKeySchema, type SkillKey } from "./skills";
import { followUpState, loadFollowUp, snapshot, sourceIsCurrent } from "./state";

export { caseHeardOnCall } from "./exposure";
export { scenarioDigest } from "./skills";

export const createSchema = z.object({
  skillKey: skillKeySchema,
  items: z.array(z.object({
    attemptId: z.string().min(1).max(64),
    practiceScenarioId: z.string().min(1).max(64),
    controlScenarioId: z.string().min(1).max(64),
  })).min(1).max(30),
});
export type CreateInput = z.infer<typeof createSchema>;
export type CreateResult = { ok: true; practiceLessonId: string; controlLessonId: string; followUpIds: string[]; existing: boolean }
  | { ok: false; status: number; error: string };
const fail = (error: string, status = 400): CreateResult => ({ ok: false, status, error });

type Tx = Prisma.TransactionClient;

/** Whether a case suits this student for this stage; the text says why not (followup/pool.ts). */
function caseProblem(skill: SkillKey, s: PoolScenario, ctx: PoolContext, purpose: "practice" | "control", who: string): string | null {
  const why = unsuitable(skill, s, ctx, purpose);
  if (!why) return null;
  if (why === SEEN) return `Контрольная ситуация «${s.title}» уже предъявлялась ученику ${who}: для контроля нужна новая`;
  return `«${s.title}» не подходит для ${purpose === "practice" ? "отработки" : "контроля"} ученику ${who}: ${why}`;
}

/** One request, one coherent class task. All reads and creations share a serializable transaction. */
export async function createFollowUps(user: SessionUser, request: Request, raw: unknown): Promise<CreateResult> {
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return fail("Выберите цель и задания для отработки и контроля");
  const input = parsed.data;
  const ids = input.items.map((i) => i.attemptId);
  if (new Set(ids).size !== ids.length) return fail("Один ученик не может быть добавлен дважды", 409);
  const scenarioIds = [...new Set(input.items.flatMap((i) => [i.practiceScenarioId, i.controlScenarioId]))];

  try {
    return await db.$transaction(async (tx) => {
      const attempts = await tx.attempt.findMany({
        where: { id: { in: ids }, ...attemptScope(user) },
        include: { lesson: true, seat: { include: { service: true } }, student: { select: { fullName: true } } },
      });
      if (attempts.length !== ids.length) return fail("Попытка не найдена", 404);
      const byId = new Map(attempts.map((a) => [a.id, a]));
      const ordered = ids.map((id) => byId.get(id)!);
      const sourceLesson = ordered[0].lesson;
      if (sourceLesson.status !== "FINISHED" || ordered.some((a) => a.lessonId !== sourceLesson.id)) {
        return fail("Выберите проверенные попытки одного завершённого занятия", 409);
      }
      if (ordered.some((a) => a.reviewStatus === "PENDING" || !a.reviewedById || !a.reviewedAt)) {
        return fail("Сначала преподаватель должен проверить все выбранные попытки", 409);
      }
      const role: SeatRole = SKILLS[input.skillKey].role;
      if (ordered.some((a) => a.kind !== role || a.seat.role !== role)) return fail("Цель не подходит роли выбранного места", 409);
      if (new Set(ordered.map((a) => a.studentId)).size !== ordered.length) return fail("Для каждого ученика выберите одну ошибку", 409);
      if (sourceLesson.groupId) {
        const group = await tx.group.findUnique({ where: { id: sourceLesson.groupId }, select: { archivedAt: true, teacherId: true } });
        if (!group || group.archivedAt || (user.role !== "ADMIN" && group.teacherId !== user.id)) return fail("Группа занятия недоступна", 409);
        const members = await tx.groupMember.findMany({ where: { groupId: sourceLesson.groupId, userId: { in: ordered.map((a) => a.studentId) } }, select: { userId: true } });
        if (members.length !== ordered.length) return fail("Часть учеников больше не состоит в группе", 409);
      }
      const revisions = ordered.map((a) => {
        const criteria = readCriteria(a.criteria);
        const override = readOverrides(a.override);
        const effective = effectiveChecks(criteria, override);
        return { attempt: a, criteria, override, effective, digest: reviewDigest({ criteria, override, reviewedAt: a.reviewedAt, teacherComment: a.teacherComment }) };
      });
      if (revisions.some((r) => !r.effective.some((c) => (SKILLS[input.skillKey].required as readonly string[]).includes(c.code) && c.ok === false))) {
        return fail("Выберите подтверждённую ошибку по этой цели", 409);
      }
      const existing = await tx.followUp.findMany({ where: { sourceAttemptId: { in: ids }, skillKey: input.skillKey, cancelledAt: null } });
      if (existing.length) {
        const complete = existing.length === ordered.length && existing.every((f) => {
          const r = revisions.find((x) => x.attempt.id === f.sourceAttemptId);
          const item = input.items.find((x) => x.attemptId === f.sourceAttemptId);
          const snap = snapshot(f.sourceSnapshot);
          return r?.digest === f.sourceReviewDigest && snap.practiceScenarioId === item?.practiceScenarioId && snap.controlScenarioId === item?.controlScenarioId;
        }) && new Set(existing.map((f) => f.practiceLessonId)).size === 1 && new Set(existing.map((f) => f.controlLessonId)).size === 1;
        return complete
          ? { ok: true, existing: true, practiceLessonId: existing[0].practiceLessonId, controlLessonId: existing[0].controlLessonId, followUpIds: existing.map((f) => f.id) }
          : fail("Для одной из ошибок уже есть назначение; проверьте или отмените его", 409);
      }
      const scenarios = await tx.scenario.findMany({ where: { id: { in: scenarioIds } }, select: poolScenarioSelect });
      if (scenarios.length !== scenarioIds.length) return fail("Один из сценариев не найден", 409);
      const byScenario = new Map(scenarios.map((s) => [s.id, s]));
      const sourceIds = ordered.flatMap((a) => (a.scenarioId ? [a.scenarioId] : []));
      const [sources, met] = await Promise.all([
        tx.scenario.findMany({ where: { id: { in: sourceIds } }, select: poolScenarioSelect }),
        seenSituations(tx, ordered.map((a) => a.studentId)),
      ]);
      // The same rules as the teacher's form (followup/pool.ts): role, service and territory of the place, not the
      // situation of the error, comparable difficulty, a control new to the student and different from the practice.
      for (const item of input.items) {
        const source = byId.get(item.attemptId)!;
        const ctx: PoolContext = {
          source: sources.find((s) => s.id === source.scenarioId) ?? null,
          service: role === "DDS" ? source.seat.service : null,
          seen: met.get(source.studentId) ?? new Set(),
        };
        const practice = byScenario.get(item.practiceScenarioId)!;
        const control = byScenario.get(item.controlScenarioId)!;
        const problem = caseProblem(input.skillKey, practice, ctx, "practice", source.student.fullName)
          ?? caseProblem(input.skillKey, control, ctx, "control", source.student.fullName)
          ?? pairProblem(role, caseOption(input.skillKey, practice, ctx, "practice"), caseOption(input.skillKey, control, ctx, "control"));
        if (problem) return fail(problem, 409);
      }
      const base = lessonSettingsSchema.parse(sourceLesson.settings);
      const frozenWeights = (await getActiveWeights(tx)).weights;
      const lessonTitle = `${SKILLS[input.skillKey].title} · ${sourceLesson.title}`.slice(0, 120);
      const practice = await tx.lesson.create({
        data: { title: `Отработка: ${lessonTitle}`.slice(0, 120), teacherId: sourceLesson.teacherId, groupId: sourceLesson.groupId,
          settings: { ...base, practice: false, adaptive: false, hints: true, cardSource: "generated", sameCard: false } as Prisma.InputJsonValue },
      });
      const control = await tx.lesson.create({
        data: { title: `Контроль: ${sourceLesson.title}`.slice(0, 120), teacherId: sourceLesson.teacherId, groupId: sourceLesson.groupId,
          settings: { ...base, practice: false, adaptive: false, hints: false, cardSource: "generated", sameCard: false } as Prisma.InputJsonValue },
      });
      await tx.seat.createMany({ data: input.items.flatMap((item, i) => {
        const a = byId.get(item.attemptId)!;
        return [
          { lessonId: practice.id, studentId: a.studentId, role, serviceId: a.seat.serviceId, scenarioIds: [item.practiceScenarioId], label: `Место ${i + 1}` },
          { lessonId: control.id, studentId: a.studentId, role, serviceId: a.seat.serviceId, scenarioIds: [item.controlScenarioId], label: `Место ${i + 1}` },
        ];
      }) });
      const created = [];
      for (const item of input.items) {
        const r = revisions.find((x) => x.attempt.id === item.attemptId)!;
        const sourceSnapshot = {
          sourceLessonId: sourceLesson.id, studentId: r.attempt.studentId, role, serviceId: r.attempt.seat.serviceId,
          criteria: r.effective.filter((c) => (SKILLS[input.skillKey].required as readonly string[]).includes(c.code)),
          practiceScenarioId: item.practiceScenarioId, controlScenarioId: item.controlScenarioId,
          practiceDigest: scenarioDigest(byScenario.get(item.practiceScenarioId)!), controlDigest: scenarioDigest(byScenario.get(item.controlScenarioId)!),
          passScore: base.passScore, maxCritical: base.maxCritical, weights: frozenWeights,
        };
        const followUp = await tx.followUp.create({ data: { sourceAttemptId: r.attempt.id, sourceReviewDigest: r.digest, skillKey: input.skillKey,
          sourceSnapshot: sourceSnapshot as Prisma.InputJsonValue, practiceLessonId: practice.id, controlLessonId: control.id, createdById: user.id } });
        created.push(followUp.id);
      }
      await auditInTx(tx, user, request, { action: "followup.create", entity: "Lesson", entityId: practice.id,
        after: { controlLessonId: control.id, skillKey: input.skillKey, count: created.length, followUpIds: created } });
      return { ok: true, existing: false, practiceLessonId: practice.id, controlLessonId: control.id, followUpIds: created };
    }, { isolationLevel: "Serializable" });
  } catch (err) {
    // A concurrent request can win the unique source/skill key. The UI gets a retryable conflict.
    if (err && typeof err === "object" && "code" in err && ["P2002", "P2034"].includes(String(err.code))) {
      return fail("Назначение уже создаётся; обновите страницу и повторите", 409);
    }
    throw err;
  }
}

export type StageChange = { ok: true; state: string; practiceLessonId: string; controlLessonId: string } | { ok: false; status: number; error: string };
type Link = NonNullable<Awaited<ReturnType<typeof loadFollowUp>>>;

/** The student's pool context for a follow-up: the source case, the place's service, what the student has met. */
async function contextOf(tx: Tx, link: Link): Promise<{ skill: SkillKey; ctx: PoolContext; practice: PoolScenario | null }> {
  const skill = link.skillKey as SkillKey;
  const snap = snapshot(link.sourceSnapshot);
  const studentId = link.sourceAttempt.studentId;
  const [source, service, practice, met] = await Promise.all([
    link.sourceAttempt.scenarioId ? tx.scenario.findUnique({ where: { id: link.sourceAttempt.scenarioId }, select: poolScenarioSelect }) : null,
    SKILLS[skill].role === "DDS" && snap.serviceId ? tx.service.findUnique({ where: { id: snap.serviceId } }) : null,
    snap.practiceScenarioId ? tx.scenario.findUnique({ where: { id: snap.practiceScenarioId }, select: poolScenarioSelect }) : null,
    seenSituations(tx, [studentId]),
  ]);
  return { skill, ctx: { source, service, seen: met.get(studentId) ?? new Set() }, practice };
}

/** A new control case for this student: suitable, new to the student, a valid pair with the practice case. */
async function checkNewControl(tx: Tx, link: Link, controlScenarioId: string, who: string): Promise<{ scenario: PoolScenario } | { error: string }> {
  const { skill, ctx, practice } = await contextOf(tx, link);
  const scenario = await tx.scenario.findUnique({ where: { id: controlScenarioId }, select: poolScenarioSelect });
  if (!scenario) return { error: "Сценарий не найден" };
  if (!practice) return { error: "Сценарий отработки не найден" };
  const problem = caseProblem(skill, scenario, ctx, "control", who)
    ?? pairProblem(SKILLS[skill].role, caseOption(skill, practice, ctx, "practice"), caseOption(skill, scenario, ctx, "control"));
  return problem ? { error: problem } : { scenario };
}

/** A lesson of one place for this student, with the settings of the lesson it repeats. */
async function lessonFor(tx: Tx, link: Link, from: { title: string; teacherId: string; groupId: string | null; settings: Prisma.JsonValue }, title: string, scenarioId: string) {
  const snap = snapshot(link.sourceSnapshot);
  const lesson = await tx.lesson.create({ data: { title: title.slice(0, 120), teacherId: from.teacherId, groupId: from.groupId, settings: (from.settings ?? {}) as Prisma.InputJsonValue } });
  await tx.seat.create({ data: { lessonId: lesson.id, studentId: link.sourceAttempt.studentId, role: SKILLS[link.skillKey as SkillKey].role, serviceId: snap.serviceId ?? null, scenarioIds: [scenarioId], label: "Место 1" } });
  return lesson;
}

/**
 * «Повторить отработку» / «Повторить контроль»: the stage's lesson is over and the student has no attempt in it. The
 * student gets a new draft lesson of the stage; the finished one stays in the history. A student repeating the
 * practice leaves the class control lesson for one of his own, so the rest of the class can start their control.
 * A control case the student already heard (a missed call) is replaced by a new one the teacher chooses.
 */
export async function repeatStage(tx: Tx, user: SessionUser, request: Request, link: Link, stage: "practice" | "control", controlScenarioId?: string): Promise<StageChange> {
  const state = await followUpState(tx, link);
  const snap = snapshot(link.sourceSnapshot);
  const skill = link.skillKey as SkillKey;
  const who = (await tx.user.findUnique({ where: { id: link.sourceAttempt.studentId }, select: { fullName: true } }))?.fullName ?? "";
  const before = { practiceLessonId: link.practiceLessonId, controlLessonId: link.controlLessonId, controlScenarioId: snap.controlScenarioId };
  let practiceLessonId = link.practiceLessonId;
  let controlLessonId = link.controlLessonId;
  const data: Prisma.FollowUpUpdateInput = {};
  if (stage === "practice") {
    if (state !== "practice_missed") return { ok: false, status: 409, error: "Повторить отработку можно, когда её занятие завершено, а попытки ученика в нём нет" };
    if (!snap.practiceScenarioId) return { ok: false, status: 409, error: "В назначении нет сценария отработки" };
    const practice = await lessonFor(tx, link, link.practiceLesson, `Отработка (повтор): ${SKILLS[skill].title}`, snap.practiceScenarioId);
    practiceLessonId = practice.id;
    data.practiceLesson = { connect: { id: practice.id } };
    data.practiceJudgment = Prisma.DbNull;
    const classmates = await tx.followUp.count({ where: { controlLessonId: link.controlLessonId, cancelledAt: null, id: { not: link.id } } });
    if (classmates && snap.controlScenarioId) {
      if (link.controlLesson.status !== "DRAFT") return { ok: false, status: 409, error: "Контроль класса уже начат" };
      await tx.seat.deleteMany({ where: { lessonId: link.controlLessonId, studentId: link.sourceAttempt.studentId } });
      const control = await lessonFor(tx, link, link.controlLesson, `Контроль (отдельно): ${link.controlLesson.title.replace(/^Контроль:\s*/, "")}`, snap.controlScenarioId);
      controlLessonId = control.id;
      data.controlLesson = { connect: { id: control.id } };
    }
  } else {
    if (state !== "control_missed") return { ok: false, status: 409, error: "Повторить контроль можно, когда его занятие завершено, а попытки ученика в нём нет" };
    const current = snap.controlScenarioId ? await tx.scenario.findUnique({ where: { id: snap.controlScenarioId }, select: poolScenarioSelect }) : null;
    const wanted = controlScenarioId ?? current?.id;
    if (!wanted) return { ok: false, status: 409, error: "Выберите новую контрольную ситуацию" };
    const checked = await checkNewControl(tx, link, wanted, who);
    if ("error" in checked) {
      // The case rang or came to the student in the finished control: it is no longer new, the teacher picks another.
      return { ok: false, status: 409, error: controlScenarioId ? checked.error : `${checked.error}. Выберите другую контрольную ситуацию` };
    }
    const control = await lessonFor(tx, link, link.controlLesson, `Контроль (повтор): ${link.controlLesson.title.replace(/^Контроль(\s*\([^)]*\))?:\s*/, "")}`, checked.scenario.id);
    controlLessonId = control.id;
    data.controlLesson = { connect: { id: control.id } };
    data.controlJudgment = Prisma.DbNull;
    if (checked.scenario.id !== snap.controlScenarioId) {
      data.sourceSnapshot = { ...(link.sourceSnapshot as Record<string, unknown>), controlScenarioId: checked.scenario.id, controlDigest: scenarioDigest(checked.scenario) } as Prisma.InputJsonValue;
    }
  }
  await tx.followUp.update({ where: { id: link.id }, data });
  await auditInTx(tx, user, request, { action: "followup.repeat", entity: "FollowUp", entityId: link.id, before,
    after: { stage, practiceLessonId, controlLessonId, controlScenarioId: stage === "control" ? (controlScenarioId ?? snap.controlScenarioId) : snap.controlScenarioId } });
  return { ok: true, state: stage === "practice" ? "planned" : "control_ready", practiceLessonId, controlLessonId };
}

/**
 * «Заменить контроль»: before the control starts, the student has met its case elsewhere (another lesson, practice at
 * the workstation). The student's place in the draft control lesson gets another new case.
 */
export async function replaceControl(tx: Tx, user: SessionUser, request: Request, link: Link, controlScenarioId: string): Promise<StageChange> {
  if (link.controlLesson.status !== "DRAFT") return { ok: false, status: 409, error: "Контроль уже начат — заменить ситуацию нельзя" };
  if (!sourceIsCurrent(link)) return { ok: false, status: 409, error: "Исходный разбор изменён" };
  const snap = snapshot(link.sourceSnapshot);
  if (controlScenarioId === snap.controlScenarioId) return { ok: false, status: 409, error: "Это та же контрольная ситуация" };
  const who = (await tx.user.findUnique({ where: { id: link.sourceAttempt.studentId }, select: { fullName: true } }))?.fullName ?? "";
  const checked = await checkNewControl(tx, link, controlScenarioId, who);
  if ("error" in checked) return { ok: false, status: 409, error: checked.error };
  const seat = link.controlLesson.seats.find((s) => s.studentId === link.sourceAttempt.studentId);
  if (!seat) return { ok: false, status: 409, error: "Места ученика в контроле нет" };
  await tx.seat.update({ where: { id: seat.id }, data: { scenarioIds: [checked.scenario.id] } });
  await tx.followUp.update({ where: { id: link.id }, data: {
    sourceSnapshot: { ...(link.sourceSnapshot as Record<string, unknown>), controlScenarioId: checked.scenario.id, controlDigest: scenarioDigest(checked.scenario) } as Prisma.InputJsonValue,
  } });
  await auditInTx(tx, user, request, { action: "followup.replace_control", entity: "FollowUp", entityId: link.id,
    before: { controlScenarioId: snap.controlScenarioId }, after: { controlScenarioId: checked.scenario.id } });
  return { ok: true, state: "control_ready", practiceLessonId: link.practiceLessonId, controlLessonId: link.controlLessonId };
}
