/**
 * Stores the review of ДДС plates as Attempts (kind DDS). A plate is reviewed when it reaches a final
 * answer (Не принята, Работы завершены, Отказ) and once more at the end of the lesson; a review the teacher
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
import { DDS_TX } from "./tx";

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

/** Marks the reviews written here, so other tools' attempts (demo lessons) are never rewritten. */
const PLACE_REVIEW = "dds-place";
type Draft = { by?: string; final?: boolean } | null;
const madeByPlace = (draft: unknown) => (draft as Draft)?.by === PLACE_REVIEW;

/**
 * Review one plate of a ДДС place and store it. Returns the score, or null when nothing was stored.
 * `final` marks the review made at the end of the lesson, so it runs once per plate.
 */
export async function evaluatePlate(plateId: string, now = new Date(), opts: { final?: boolean } = {}): Promise<number | null> {
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

  // The ДДС place that worked on the plate: the first of its service among the authors of the events
  // (a 112 place may have written the technical ones), else the place the card was generated for.
  const candidates = [...new Set([...plate.events.map((e) => e.seatId), incident.ddsSeatId].filter((id): id is string => !!id))];
  const ddsSeats = candidates.length
    ? await db.seat.findMany({ where: { id: { in: candidates }, role: "DDS", serviceId: plate.serviceId } })
    : [];
  const seat =
    candidates.map((id) => ddsSeats.find((st) => st.id === id)).find((st) => !!st) ??
    (await db.seat.findFirst({ where: { lessonId: lesson.id, role: "DDS", serviceId: plate.serviceId }, orderBy: { createdAt: "asc" } }));
  if (!seat) return null;
  const seatId = seat.id;

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
    aiDraft: { summary: summarize(criteria, score), source: "rules", by: PLACE_REVIEW, final: !!opts.final } as Prisma.InputJsonValue,
  };

  // One review per plate and place even when the finish button and the poll race each other.
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dds-review:${plate.id}`}))`;
    const existing = await tx.attempt.findFirst({ where: { incidentServiceId: plate.id, seatId, kind: "DDS" } });
    if (existing && existing.reviewStatus !== "PENDING") return existing.score; // the teacher has checked it
    if (existing && !madeByPlace(existing.aiDraft)) return existing.score; // someone else's review (demo lessons): leave it
    if (existing) {
      await tx.attempt.updateMany({ where: { id: existing.id, reviewStatus: "PENDING" }, data });
    } else {
      await tx.attempt.create({
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
  }, DDS_TX);
}

/** Calls of the ДДС places cannot outlive the lesson: a ringing call is lost, a talk is over. */
export async function closeLessonCalls(lessonId: string, now = new Date()): Promise<void> {
  const dds = { lessonId, seat: { role: "DDS" as const } };
  await db.call.updateMany({ where: { ...dds, status: "RINGING" }, data: { status: "MISSED", endedAt: now } });
  await db.call.updateMany({ where: { ...dds, status: { in: ["ACTIVE", "HELD"] } }, data: { status: "ENDED", endedAt: now } });
}

/**
 * The end-of-lesson review of a ДДС place: every plate gets reviewed once more with the final picture
 * (missed reports, statuses never set). Plates already reviewed finally or checked by the teacher are skipped,
 * so calling it on every poll of a finished lesson costs one query.
 */
export async function evaluateSeatPlates(seat: { id: string; lessonId: string; serviceId: number | null }): Promise<number> {
  if (!seat.serviceId) return 0;
  const plates = await db.incidentService.findMany({
    where: { serviceId: seat.serviceId, incident: seatFeedWhere(seat) },
    select: { id: true, attempts: { where: { kind: "DDS" }, select: { reviewStatus: true, aiDraft: true } } },
  });
  // Not reviewed yet, or only by the place during the lesson and still waiting for the teacher.
  const due = plates.filter((p) =>
    p.attempts.every((a) => a.reviewStatus === "PENDING" && madeByPlace(a.aiDraft) && !(a.aiDraft as Draft)?.final),
  );
  for (const p of due) await evaluatePlate(p.id, new Date(), { final: true });
  return due.length;
}

/** For the teacher's «finish lesson»: close the calls and review all ДДС places of the lesson. Safe to call repeatedly. */
export async function finishLessonEvaluation(lessonId: string): Promise<number> {
  await closeLessonCalls(lessonId);
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
