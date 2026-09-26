/**
 * Card flow of a ДДС place. There are no background workers: every poll of the feed calls
 * ensureDdsFlow(seatId), which brings the place up to date — a new card when the tempo allows,
 * the other services' plates moving, crew reports ringing in (see calls.ts).
 *
 * Cards arrive at the same time, as in real work: the queue may hold up to maxQueue open cards, and
 * the 30-second norm ticks for every one of them (customer's answer #709).
 */
import type { Prisma, Seat } from "@prisma/client";
import { db } from "@/lib/db";
import type { LessonSettings } from "@/lib/lessons/settings";
import { botActor, botPlan, dueSteps, hash } from "@/lib/dds/bots";
import { phoneTick } from "@/lib/dds/calls";
import { ddsCardOf } from "@/lib/dds/scenario";
import { DONE_STATUSES, seatFeedWhere, settingsOf, SYSTEM_ACTOR, TRAINING_OPERATOR, type SeatRef } from "@/lib/dds/scope";

type Tx = Prisma.TransactionClient;

export { DONE_STATUSES, SYSTEM_ACTOR, TRAINING_OPERATOR, seatFeedWhere, settingsOf } from "@/lib/dds/scope";

export type FlowInfo = {
  running: boolean;
  queue: number;
  maxQueue: number;
  /** Seconds until the next generated card; null when the queue is full or cards come from students only. */
  nextCardInSec: number | null;
  noScenarios: boolean;
};

export async function ensureDdsFlow(seatId: string, now = new Date()): Promise<FlowInfo> {
  return db.$transaction(
    async (tx) => {
      // One flow step per place at a time: two open tabs must not create two cards.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dds-flow:${seatId}`}))`;
      const seat = await tx.seat.findUnique({ where: { id: seatId }, include: { lesson: true, service: true } });
      const idle: FlowInfo = { running: false, queue: 0, maxQueue: 0, nextCardInSec: null, noScenarios: false };
      if (!seat || seat.role !== "DDS" || !seat.serviceId) return idle;
      const settings = settingsOf(seat.lesson.settings);
      if (seat.lesson.status !== "RUNNING") return { ...idle, maxQueue: settings.maxQueue };

      const info = await maybeGenerate(tx, seat, settings, now);
      await advanceBots(tx, seat, now);
      await phoneTick(tx, seat, settings, now);
      return info;
    },
    { timeout: 15_000, maxWait: 10_000 },
  );
}

async function openCount(tx: Tx, seat: SeatRef): Promise<number> {
  if (!seat.serviceId) return 0;
  return tx.incidentService.count({
    where: { serviceId: seat.serviceId, status: { notIn: [...DONE_STATUSES] }, incident: seatFeedWhere(seat) },
  });
}

async function maybeGenerate(
  tx: Tx,
  seat: Seat & { lesson: { id: string } },
  settings: LessonSettings,
  now: Date,
): Promise<FlowInfo> {
  const queue = await openCount(tx, seat);
  const base: FlowInfo = { running: true, queue, maxQueue: settings.maxQueue, nextCardInSec: null, noScenarios: false };
  if (settings.cardSource === "students") return base;
  if (queue >= settings.maxQueue) return base;

  const last = await tx.incident.findFirst({
    where: { ddsSeatId: seat.id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (last) {
    const wait = settings.tempoSec - (now.getTime() - last.createdAt.getTime()) / 1000;
    if (wait > 0) return { ...base, nextCardInSec: Math.ceil(wait) };
  }

  const scenario = await pickScenario(tx, seat, settings);
  if (!scenario) return { ...base, noScenarios: true };
  await createCard(tx, seat, scenario, now);
  return { ...base, queue: queue + 1, nextCardInSec: queue + 1 >= settings.maxQueue ? null : settings.tempoSec };
}

const scenarioSelect = {
  id: true,
  title: true,
  category: true,
  caller: true,
  truth: true,
  ddsCard: true,
  ddsReference: true,
} satisfies Prisma.ScenarioSelect;

type PickedScenario = Prisma.ScenarioGetPayload<{ select: typeof scenarioSelect }>;

/**
 * Tasks assigned to the place come first, in order; otherwise a random approved scenario of the
 * lesson's categories. Scenarios already shown at this place are used again only when the pool is exhausted.
 */
async function pickScenario(tx: Tx, seat: Seat, settings: LessonSettings): Promise<PickedScenario | null> {
  const where: Prisma.ScenarioWhereInput = { status: "APPROVED" };
  if (seat.scenarioIds.length) where.id = { in: seat.scenarioIds };
  else if (settings.categories.length) where.category = { in: settings.categories };

  const pool = await tx.scenario.findMany({ where, select: scenarioSelect });
  if (!pool.length) return null;
  const used = new Set(
    (await tx.incident.findMany({ where: { ddsSeatId: seat.id }, select: { scenarioId: true } })).map((i) => i.scenarioId),
  );
  const fresh = pool.filter((s) => !used.has(s.id));
  if (seat.scenarioIds.length && fresh.length) {
    const order = new Map(seat.scenarioIds.map((id, i) => [id, i]));
    return fresh.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))[0];
  }
  const list = fresh.length ? fresh : pool;
  return list[Math.floor(Math.random() * list.length)];
}

async function createCard(tx: Tx, seat: Seat, scenario: PickedScenario, now: Date) {
  const spec = ddsCardOf(scenario);
  const ownId = seat.serviceId!;
  const known = new Set(
    (await tx.service.findMany({ where: { id: { in: [...spec.services, ownId] } }, select: { id: true } })).map((s) => s.id),
  );
  // Own plate is always on the card, whatever the scenario lists.
  const serviceIds = [...new Set([...spec.services.filter((id) => known.has(id)), ownId])];
  const count = await tx.incident.count({ where: { ddsSeatId: seat.id } });
  const savedAt = new Date(now.getTime() - 4_000);

  await tx.incident.create({
    data: {
      lessonId: seat.lessonId,
      scenarioId: scenario.id,
      source: "generated",
      ddsSeatId: seat.id,
      operatorNo: "0",
      armNo: String(1 + (hash(`${seat.id}:${count}`) % 9)),
      status: "registered",
      caller: spec.caller as Prisma.InputJsonValue,
      address: spec.address as Prisma.InputJsonValue,
      typeCodes: spec.typeCodes,
      tags: spec.tags as Prisma.InputJsonValue,
      flags: spec.flags as Prisma.InputJsonValue,
      description: spec.description,
      descriptionLog: [{ at: savedAt.toISOString(), author: TRAINING_OPERATOR, text: spec.description ?? scenario.title }],
      important: spec.important,
      openedAt: new Date(savedAt.getTime() - 55_000),
      savedAt,
      services: {
        create: serviceIds.map((serviceId, i) => ({
          serviceId,
          isMain: i === 0,
          addedBy: "auto",
          status: "ADDED" as const,
          addedAt: now,
          events: { create: { status: "ADDED" as const, actorLabel: SYSTEM_ACTOR, at: now } },
        })),
      },
    },
  });
}

/** Moves the plates of other services on the cards of this place (see bots.ts). */
async function advanceBots(tx: Tx, seat: SeatRef, now: Date) {
  if (!seat.serviceId) return;
  // On shared cards from 112 places, plates of services that have their own ДДС place are live.
  const live = new Set(
    (await tx.seat.findMany({ where: { lessonId: seat.lessonId, role: "DDS" }, select: { serviceId: true } }))
      .map((s) => s.serviceId)
      .filter((id): id is number => id != null),
  );
  const plates = await tx.incidentService.findMany({
    where: {
      incident: seatFeedWhere(seat),
      serviceId: { not: seat.serviceId },
      status: { notIn: [...DONE_STATUSES] },
      addedAt: { gte: new Date(now.getTime() - 6 * 3_600_000) },
      service: { delivery: { not: "PHONE" } },
    },
    include: { service: { select: { shortName: true, delivery: true } }, incident: { select: { ddsSeatId: true } } },
  });

  for (const plate of plates) {
    if (!plate.incident.ddsSeatId && live.has(plate.serviceId)) continue;
    const plan = botPlan({ id: plate.id, serviceId: plate.serviceId, ...plate.service });
    const due = dueSteps(plan, plate.status, (now.getTime() - plate.addedAt.getTime()) / 1000);
    if (!due.length) continue;

    let crew = plate.crewNumber;
    const events = due.map((step) => {
      crew = step.crewNumber ?? crew;
      return {
        incidentServiceId: plate.id,
        status: step.status,
        comment: step.comment ?? null,
        crewNumber: crew,
        actorLabel: botActor({ id: plate.id, shortName: plate.service.shortName }),
        at: new Date(plate.addedAt.getTime() + step.afterSec * 1000),
      };
    });
    // Optimistic step: another place polling the same shared card may have moved it already.
    const moved = await tx.incidentService.updateMany({
      where: { id: plate.id, status: plate.status },
      data: { status: due[due.length - 1].status, crewNumber: crew },
    });
    if (moved.count) await tx.statusEvent.createMany({ data: events });
  }
}
