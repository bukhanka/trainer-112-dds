/**
 * Stores the review of ДДС plates as Attempts (kind DDS). A plate is reviewed when it reaches a final
 * answer (Не принята, Работы завершены, Отказ) and again at the end of the lesson; a review the teacher
 * has already confirmed or corrected is never overwritten.
 */
import type { Call, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { type CriterionResult, type Weights, WEIGHT_GROUPS } from "@/lib/scoring/score";
import type { Counterpart } from "./calls";
import { dispatchOf } from "./crew";
import { evaluateDdsPlate, scoreOf, summarize } from "./evaluate";
import { referenceFor } from "./scenario";
import { seatFeedWhere, settingsOf } from "./scope";
import { rulesFor } from "./status";

export const DEFAULT_WEIGHTS: Weights = { timeliness: 3, statusOrder: 2, comments: 2, address: 3, services: 3, completeness: 1, literacy: 1 };

export async function activeWeights(): Promise<Weights> {
  const profile = await db.weightProfile.findFirst({ where: { isActive: true }, orderBy: { updatedAt: "desc" } });
  const raw = (profile?.weights ?? {}) as Partial<Record<string, unknown>>;
  const out = { ...DEFAULT_WEIGHTS };
  for (const group of Object.keys(WEIGHT_GROUPS) as (keyof Weights)[]) {
    const v = Number(raw[group]);
    if (Number.isFinite(v) && v >= 0) out[group] = v;
  }
  return out;
}

const cp = (call: Pick<Call, "counterpart">) => (call.counterpart ?? {}) as Counterpart;

/** Review one plate of a ДДС place and store it. Returns the score, or null when nothing was stored. */
export async function evaluatePlate(plateId: string, now = new Date()): Promise<number | null> {
  const plate = await db.incidentService.findUnique({
    where: { id: plateId },
    include: {
      service: true,
      events: { orderBy: { at: "asc" } },
      incident: { include: { lesson: true, scenario: { select: { id: true, ddsReference: true } } } },
    },
  });
  if (!plate?.incident.lesson) return null;
  const { incident } = plate;
  const lesson = incident.lesson!;

  // The place that worked on the plate: whoever acted on it, else the place the card was generated for.
  const seatId =
    plate.events.find((e) => e.seatId)?.seatId ??
    incident.ddsSeatId ??
    (await db.seat.findFirst({ where: { lessonId: lesson.id, role: "DDS", serviceId: plate.serviceId }, select: { id: true } }))?.id;
  if (!seatId) return null;
  const seat = await db.seat.findUnique({ where: { id: seatId } });
  if (!seat || seat.role !== "DDS" || seat.serviceId !== plate.serviceId) return null;

  const existing = await db.attempt.findFirst({ where: { incidentServiceId: plate.id, seatId, kind: "DDS" } });
  if (existing && existing.reviewStatus !== "PENDING") return existing.score;

  const settings = settingsOf(lesson.settings);
  const calls = await db.call.findMany({ where: { seatId, incidentId: incident.id } });
  const crewCalls = calls.filter((c) => c.kind === "BRIGADE_IN" || c.kind === "BRIGADE_OUT");
  const phoneDispatch = crewCalls
    .map(cp)
    .filter((c) => c.crew && c.dispatch?.incidentId === incident.id)
    .map((c) => ({ crew: c.crew!, at: new Date(c.dispatch!.at) }));
  const reports = crewCalls.flatMap((c) => (cp(c).reports ?? []).map((r) => ({ status: r.status, at: new Date(r.at) })));
  const incoming = calls.filter((c) => c.kind === "BRIGADE_IN" && c.status !== "RINGING");

  const end = lesson.status === "FINISHED" && lesson.finishedAt ? lesson.finishedAt : now;
  const criteria: CriterionResult[] = evaluateDdsPlate({
    addedAt: plate.addedAt,
    status: plate.status,
    events: plate.events.map((e) => ({ status: e.status, comment: e.comment, crewNumber: e.crewNumber, at: e.at, late: e.late })),
    rules: rulesFor(plate.service),
    ackSec: settings.ackSec,
    workSec: settings.workSec,
    reference: referenceFor(incident.scenario?.ddsReference, plate.service),
    dispatch: dispatchOf(plate.events, phoneDispatch),
    reports,
    crewCalls: { rang: incoming.length, missed: incoming.filter((c) => c.status === "MISSED").length },
    callbacks: calls.filter((c) => c.kind === "CALLER_OUT").map((c) => ({ at: c.startedAt, namedCardNumber: !!cp(c).namedCardNumber })),
    now: end,
  });
  const score = scoreOf(criteria, await activeWeights());
  const data = {
    criteria: criteria as unknown as Prisma.InputJsonValue,
    score,
    aiDraft: { summary: summarize(criteria, score), source: "rules" } as Prisma.InputJsonValue,
  };

  if (existing) {
    await db.attempt.updateMany({ where: { id: existing.id, reviewStatus: "PENDING" }, data });
  } else {
    await db.attempt.create({
      data: {
        ...data,
        lessonId: lesson.id,
        seatId,
        studentId: seat.studentId,
        kind: "DDS",
        incidentId: incident.id,
        incidentServiceId: plate.id,
        scenarioId: incident.scenarioId,
      },
    });
  }
  return score;
}

/** Review every plate of a ДДС place that has no review yet (after the lesson ended). */
export async function evaluateSeatPlates(seat: { id: string; lessonId: string; serviceId: number | null }): Promise<number> {
  if (!seat.serviceId) return 0;
  const plates = await db.incidentService.findMany({
    where: { serviceId: seat.serviceId, incident: seatFeedWhere(seat), attempts: { none: { seatId: seat.id, kind: "DDS" } } },
    select: { id: true },
  });
  for (const p of plates) await evaluatePlate(p.id);
  return plates.length;
}

/** For the teacher's «finish lesson»: review all ДДС places of the lesson. Safe to call repeatedly. */
export async function finishLessonEvaluation(lessonId: string): Promise<number> {
  const seats = await db.seat.findMany({ where: { lessonId, role: "DDS" }, select: { id: true, lessonId: true, serviceId: true } });
  let count = 0;
  for (const seat of seats) count += await evaluateSeatPlates(seat);
  return count;
}

export type ResultRow = {
  id: string;
  incidentNumber: number | null;
  title: string;
  score: number | null;
  reviewStatus: string;
  createdAt: string;
  summary: string;
  criteria: CriterionResult[];
};

/** Reviews of one place, newest first — for the student's own results panel. */
export async function seatResults(seatId: string): Promise<{ rows: ResultRow[]; average: number | null }> {
  const attempts = await db.attempt.findMany({
    where: { seatId, kind: "DDS" },
    orderBy: { createdAt: "desc" },
    include: { incident: { select: { number: true, description: true } }, scenario: { select: { title: true } } },
  });
  const rows = attempts.map((a) => ({
    id: a.id,
    incidentNumber: a.incident?.number ?? null,
    title: a.scenario?.title ?? a.incident?.description ?? "",
    score: a.score,
    reviewStatus: a.reviewStatus,
    createdAt: a.createdAt.toISOString(),
    summary: ((a.aiDraft as { summary?: string } | null)?.summary ?? "") as string,
    criteria: (a.criteria ?? []) as unknown as CriterionResult[],
  }));
  const scored = rows.filter((r) => r.score !== null);
  const average = scored.length ? Math.round(scored.reduce((s, r) => s + r.score!, 0) / scored.length) : null;
  return { rows, average };
}
