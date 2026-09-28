/**
 * Card flow of a ДДС place. There are no background workers: every poll of the feed calls
 * ensureDdsFlow(seatId), which brings the place up to date — a new card when the tempo allows,
 * the other services' plates moving, crew reports ringing in (see calls.ts).
 *
 * Cards arrive at the same time, as in real work: the queue may hold up to maxQueue open cards, and
 * the 30-second norm ticks for every one of them (customer's answer #709).
 */
import type { Prisma, Seat } from "@prisma/client";
import { serviceOn } from "@/lib/admin/services";
import { db } from "@/lib/db";
import { adaptiveChoice, type LessonSettings } from "@/lib/lessons/settings";
import { botActor, botPlan, dueSteps, hash } from "@/lib/dds/bots";
import { phoneTick } from "@/lib/dds/calls";
import { ddsCardOf, hasOwnReference, platesForPlace, reachesPlace } from "@/lib/dds/scenario";
import { DONE_STATUSES, seatFeedWhere, settingsOf, SYSTEM_ACTOR, TRAINING_OPERATOR, type SeatRef } from "@/lib/dds/scope";
import { studentRating } from "@/lib/adaptive/levels";
import { pickAdaptive } from "@/lib/adaptive/pick";
import { inPlayAt112, latestScenario, notRightAfter, preferNotInPlay } from "@/lib/lessons/in-play";
import { withoutPairsOf, withPairs } from "@/lib/scenarios/pairs";
import { inLessonLocation } from "@/lib/scenarios/place";

type Tx = Prisma.TransactionClient;

export { DONE_STATUSES, SYSTEM_ACTOR, TRAINING_OPERATOR, seatFeedWhere, settingsOf } from "@/lib/dds/scope";

export type FlowInfo = {
  running: boolean;
  queue: number;
  maxQueue: number;
  /** Seconds until the next generated card; null when the queue is full or cards come from students only. */
  nextCardInSec: number | null;
  noScenarios: boolean;
  /** New cards are paused by the administrator (Состояние → Службы); open cards and calls go on. */
  paused?: boolean;
};

export async function ensureDdsFlow(seatId: string, now = new Date()): Promise<FlowInfo> {
  const paused = !(await serviceOn("ddsFlow"));
  return db.$transaction(
    async (tx) => {
      // One flow step per place at a time: two open tabs must not create two cards.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`dds-flow:${seatId}`}))`;
      const seat = await tx.seat.findUnique({ where: { id: seatId }, include: { lesson: true, service: true } });
      const idle: FlowInfo = { running: false, queue: 0, maxQueue: 0, nextCardInSec: null, noScenarios: false };
      if (!seat || seat.role !== "DDS" || !seat.serviceId) return idle;
      const settings = settingsOf(seat.lesson.settings);
      if (seat.lesson.status !== "RUNNING") return { ...idle, maxQueue: settings.maxQueue };

      const info = await maybeGenerate(tx, seat, settings, now, paused);
      await advanceBots(tx, seat, settings, now);
      await phoneTick(tx, seat, settings, now);
      return info;
    },
    { timeout: 15_000, maxWait: 10_000 },
  );
}

async function openCount(tx: Tx, seat: SeatRef, settings: LessonSettings): Promise<number> {
  if (!seat.serviceId) return 0;
  return tx.incidentService.count({
    where: { serviceId: seat.serviceId, status: { notIn: [...DONE_STATUSES] }, incident: seatFeedWhere(seat, settings) },
  });
}

async function maybeGenerate(
  tx: Tx,
  seat: Seat & { lesson: { id: string; settings: Prisma.JsonValue } },
  settings: LessonSettings,
  now: Date,
  paused = false,
): Promise<FlowInfo> {
  const queue = await openCount(tx, seat, settings);
  const base: FlowInfo = { running: true, queue, maxQueue: settings.maxQueue, nextCardInSec: null, noScenarios: false };
  if (settings.cardSource === "students") return base;
  if (paused) return { ...base, paused: true };
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

  const scenario = await pickScenario(tx, seat, settings, adaptiveChoice(seat.lesson.settings));
  if (!scenario) return { ...base, noScenarios: true };
  await createCard(tx, seat, scenario, now);
  return { ...base, queue: queue + 1, nextCardInSec: queue + 1 >= settings.maxQueue ? null : settings.tempoSec };
}

const scenarioSelect = {
  id: true,
  ticketRef: true,
  title: true,
  category: true,
  difficulty: true,
  caller: true,
  truth: true,
  ddsCard: true,
  ddsReference: true,
} satisfies Prisma.ScenarioSelect;

type PickedScenario = Prisma.ScenarioGetPayload<{ select: typeof scenarioSelect }>;

/**
 * Tasks assigned to the place come first, in order; otherwise an approved scenario of the lesson's
 * categories and location — near the student's level when the lesson is adaptive (src/lib/adaptive), at random
 * when it is not. Scenarios already shown at this place are used again only when the pool is exhausted; a ticket and
 * its variant with an error in the card show the same card, so the place gets only one of the two (scenarios/pairs.ts).
 */
export async function pickScenario(tx: Tx, seat: Seat, settings: LessonSettings, adaptive: boolean): Promise<PickedScenario | null> {
  const where: Prisma.ScenarioWhereInput = { status: "APPROVED" };
  if (seat.scenarioIds.length) where.id = { in: seat.scenarioIds };
  else if (settings.categories.length) where.category = { in: settings.categories };

  // A scenario without a ДДС card (a silent line, a call that breaks off) is a task for the 112 place only.
  const withCard = (await tx.scenario.findMany({ where, select: scenarioSelect })).filter((s) => s.ddsCard !== null);
  const found = inLessonLocation(withCard, seat, settings);
  if (!found.length) return null;
  const feed = await tx.incident.findMany({
    where: seatFeedWhere(seat, settings),
    select: { scenarioId: true, createdAt: true, scenario: { select: { ticketRef: true } } },
  });
  // A place drawing by itself never gets the other half of a pair it has had in its feed (dealt to it or saved at a 112
  // place), skips what the 112 places of the lesson are working on right now (lessons/in-play.ts) and takes first the
  // situations that would reach its ДДС in real work. A narrow choice never deals the same situation twice in a row
  // while there is another: the preferences give way first. Tasks assigned by the teacher come as they are.
  const had = feed.flatMap((i) => (i.scenarioId ? [{ id: i.scenarioId, ticketRef: i.scenario?.ticketRef }] : []));
  const drawn = seat.scenarioIds.length ? found : withoutPairsOf(found, had);
  const free = seat.scenarioIds.length ? drawn : preferNotInPlay(drawn, withPairs(await inPlayAt112(tx, seat.lessonId), withCard));
  const wanted = seat.scenarioIds.length ? drawn : await preferReaching(tx, seat, free);
  const pool = notRightAfter([wanted, free, drawn], latestScenario(feed));
  if (!seat.scenarioIds.length && adaptive) {
    const lastUsed = new Map<string, number>();
    for (const i of feed) if (i.scenarioId) lastUsed.set(i.scenarioId, Math.max(lastUsed.get(i.scenarioId) ?? 0, i.createdAt.getTime()));
    const level = await studentRating(seat.studentId, "DDS", tx);
    return pickAdaptive(pool, { target: level.difficulty, lastUsed });
  }
  const used = new Set(feed.map((i) => i.scenarioId));
  const fresh = pool.filter((s) => !used.has(s.id));
  if (seat.scenarioIds.length && fresh.length) {
    const order = new Map(seat.scenarioIds.map((id, i) => [id, i]));
    return fresh.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))[0];
  }
  const list = fresh.length ? fresh : pool;
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * First the situations whose reference has an entry for the place (its service or its territorial level): only
 * there the place's decision and crew are judged. Then those whose card carries the place's own service or a
 * territorial plate of its level; all of them when there are none (the teacher chose, say, only «медицина»).
 */
async function preferReaching(tx: Tx, seat: Seat, pool: PickedScenario[]): Promise<PickedScenario[]> {
  const own = seat.serviceId ? await tx.service.findUnique({ where: { id: seat.serviceId }, select: { shortName: true } }) : null;
  if (!own) return pool;
  const withEntry = pool.filter((s) => hasOwnReference(s.ddsReference, { id: seat.serviceId!, shortName: own.shortName }));
  if (withEntry.length) return withEntry;
  const specs = pool.map((scenario) => ({ scenario, spec: ddsCardOf(scenario) }));
  const ids = [...new Set(specs.flatMap((x) => x.spec.services))];
  const names = new Map((ids.length ? await tx.service.findMany({ where: { id: { in: ids } }, select: { id: true, shortName: true } }) : []).map((r) => [r.id, r.shortName]));
  const reaching = specs
    .filter(({ spec }) => reachesPlace(spec.services.length ? spec.services.map((id) => names.get(id) ?? "") : spec.serviceNames, own))
    .map((x) => x.scenario);
  return reaching.length ? reaching : pool;
}

async function createCard(tx: Tx, seat: Seat, scenario: PickedScenario, now: Date) {
  const spec = ddsCardOf(scenario);
  const select = { id: true, shortName: true } as const;
  const own = await tx.service.findUnique({ where: { id: seat.serviceId! }, select });
  if (!own) return;
  const listed = spec.services.length
    ? await tx.service.findMany({ where: { id: { in: spec.services } }, select })
    : await tx.service.findMany({ where: { shortName: { in: spec.serviceNames } }, select });
  // Keep the scenario's order of plates; unknown ids or names are skipped.
  const ordered = (spec.services.length ? spec.services.map((id) => listed.find((s) => s.id === id)) : spec.serviceNames.map((n) => listed.find((s) => s.shortName === n)))
    .filter((s): s is { id: number; shortName: string } => !!s);
  // Own plate is always on the card (#684): a territorial place takes the plate of its level, others are added.
  const serviceIds = [...new Set(platesForPlace(ordered, own).map((s) => s.id))];
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
async function advanceBots(tx: Tx, seat: SeatRef, settings: LessonSettings, now: Date) {
  if (!seat.serviceId) return;
  // On shared cards from 112 places, plates of services that have their own ДДС place are live.
  const live = new Set(
    (await tx.seat.findMany({ where: { lessonId: seat.lessonId, role: "DDS" }, select: { serviceId: true } }))
      .map((s) => s.serviceId)
      .filter((id): id is number => id != null),
  );
  const plates = await tx.incidentService.findMany({
    where: {
      incident: seatFeedWhere(seat, settings),
      serviceId: { not: seat.serviceId },
      status: { notIn: [...DONE_STATUSES] },
      addedAt: { gte: new Date(now.getTime() - 6 * 3_600_000) },
      service: { delivery: { not: "PHONE" } },
    },
    include: { service: { select: { shortName: true, delivery: true } }, incident: { select: { ddsSeatId: true } } },
    orderBy: { id: "asc" }, // the same order in every place's transaction: no deadlocks on shared cards
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
