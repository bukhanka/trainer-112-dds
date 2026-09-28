import { createHash } from "node:crypto";
import type { Prisma, SeatRole } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { referenceFor, hasCardError, territorialLevel } from "@/lib/dds/scenario";
import { readCriteria, readOverrides } from "@/lib/review/draft";
import { getActiveWeights } from "@/lib/scoring/weights";
import { lessonSettingsSchema } from "@/lib/lessons/settings";
import { scenarioOfCall } from "@/lib/lessons/in-play";
import { scenarioPlace } from "@/lib/scenarios/place";
import { sameName } from "@/lib/scenarios/location";
import { attemptScope, auditInTx } from "@/lib/teacher/access";
import type { SessionUser } from "@/lib/auth/session";
import { eligiblePair, effectiveChecks, learningMeta, reviewDigest, SKILLS, skillKeySchema } from "./skills";

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
const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function caseHeardOnCall(caseIds: string[], calls: { counterpart: Prisma.JsonValue }[]): boolean {
  return calls.some((call) => { const id = scenarioOfCall(call); return Boolean(id && caseIds.includes(id)); });
}
export const scenarioDigest = (s: { caller: unknown; truth: unknown; ddsCard: unknown; ddsReference: unknown; learningMeta: unknown; updatedAt: Date }) =>
  sha([s.caller, s.truth, s.ddsCard, s.ddsReference, s.learningMeta]);

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
        include: { lesson: true, seat: { include: { service: true } } },
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
          const snap = f.sourceSnapshot as { practiceScenarioId?: string; controlScenarioId?: string };
          return r?.digest === f.sourceReviewDigest && snap.practiceScenarioId === item?.practiceScenarioId && snap.controlScenarioId === item?.controlScenarioId;
        }) && new Set(existing.map((f) => f.practiceLessonId)).size === 1 && new Set(existing.map((f) => f.controlLessonId)).size === 1;
        return complete
          ? { ok: true, existing: true, practiceLessonId: existing[0].practiceLessonId, controlLessonId: existing[0].controlLessonId, followUpIds: existing.map((f) => f.id) }
          : fail("Для одной из ошибок уже есть назначение; проверьте или отмените его", 409);
      }
      const scenarios = await tx.scenario.findMany({ where: { id: { in: scenarioIds } } });
      if (scenarios.length !== scenarioIds.length) return fail("Один из сценариев не найден", 409);
      const byScenario = new Map(scenarios.map((s) => [s.id, s]));
      const allMeta = await tx.scenario.findMany({ select: { id: true, learningMeta: true } });
      for (const item of input.items) {
        const source = byId.get(item.attemptId)!;
        const practice = byScenario.get(item.practiceScenarioId)!;
        const control = byScenario.get(item.controlScenarioId)!;
        const pm = learningMeta(practice.learningMeta);
        const cm = learningMeta(control.learningMeta);
        if (practice.status !== "APPROVED" || control.status !== "APPROVED" || !eligiblePair(pm, cm, input.skillKey)) {
          return fail("Нужны два утверждённых сопоставимых сценария: для отработки и отдельного контроля", 409);
        }
        const caseIds = allMeta.filter((s) => learningMeta(s.learningMeta)?.caseKey === cm!.caseKey).map((s) => s.id);
        const ownSeats = await tx.seat.findMany({ where: { studentId: source.studentId }, select: { id: true } });
        const seatIds = ownSeats.map((s) => s.id);
        const [seenCard, callerCalls] = await Promise.all([
          tx.incident.findFirst({
            where: { scenarioId: { in: caseIds }, OR: [{ createdBySeatId: { in: seatIds } }, { ddsSeatId: { in: seatIds } }] },
            select: { id: true },
          }),
          tx.call.findMany({ where: { seatId: { in: seatIds }, kind: "CALLER_IN" }, select: { counterpart: true } }),
        ]);
        // A caller's case has already been exposed even if the operator never saved a card.
        if (seenCard || caseHeardOnCall(caseIds, callerCalls)) {
          return fail("Контрольная ситуация уже предъявлялась одному из учеников", 409);
        }
        if (role === "OP112") {
          if (hasCardError(practice.ddsReference) || hasCardError(control.ddsReference)) return fail("Сценарий с ошибочной готовой карточкой предназначен месту ДДС", 409);
        } else {
          const service = source.seat.service;
          if (!service || !practice.ddsCard || !control.ddsCard || !referenceFor(practice.ddsReference, service) || !referenceFor(control.ddsReference, service)) {
            return fail("Для службы этого ученика нет подходящей карточки и эталона ДДС", 409);
          }
          const level = territorialLevel(service.shortName);
          if (level) {
            const name = service.shortName.replace(/^Поселение\s+/i, "");
            for (const s of [practice, control]) {
              const place = scenarioPlace(s.truth);
              const expected = level === "district" ? place.district : place.okrug;
              if (!expected || !sameName(expected, name)) return fail("Карточка находится вне территории службы ученика", 409);
            }
          }
        }
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
        after: { controlLessonId: control.id, skillKey: input.skillKey, count: created.length } });
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
