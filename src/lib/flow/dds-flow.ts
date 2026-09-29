import { isControl } from "@/lib/followup/skills";
import { canIssueControl } from "@/lib/followup/state";
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
import { ddsCardOf, hasOwnReference, personaOf, reachesPlace } from "@/lib/dds/scenario";
import { distinctCaller } from "@/lib/op112/identity";
import { lessonCallers } from "@/lib/op112/identity-db";
import { hasStreets, houseKey, movable, moveCard, moveFor, placeOfAddress, platesFor, territoryMatch, territoryOf, type Territory } from "@/lib/dds/territory";
import { DONE_STATUSES, seatFeedWhere, settingsOf, SYSTEM_ACTOR, TRAINING_OPERATOR, type SeatRef } from "@/lib/dds/scope";
import { studentRating } from "@/lib/adaptive/levels";
import { pickAdaptive } from "@/lib/adaptive/pick";
import { inPlayAt112, preferNotInPlay, takenAt112 } from "@/lib/lessons/in-play";
import { situationOf, withoutPairsOf, withPairs } from "@/lib/scenarios/pairs";
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
  /** Every task and scenario this place can get in the lesson has come: no new generated cards (Seat.dealtOutAt). */
  exhausted?: boolean;
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

/** A place that has had everything looks again this often: a situation busy at a 112 place may come free. */
const DEALT_OUT_RETRY_MS = 20_000;
/** When each such place last looked in vain, in this process. */
const lookedInVain = new Map<string, number>();

async function maybeGenerate(
  tx: Tx,
  seat: Seat & { lesson: { id: string; settings: Prisma.JsonValue } },
  settings: LessonSettings,
  now: Date,
  paused = false,
): Promise<FlowInfo> {
  const queue = await openCount(tx, seat, settings);
  const base: FlowInfo = { running: true, queue, maxQueue: settings.maxQueue, nextCardInSec: null, noScenarios: false, exhausted: !!seat.dealtOutAt };
  if (settings.cardSource === "students") return { ...base, exhausted: false };
  if (paused) return { ...base, paused: true };
  if (queue >= settings.maxQueue) return base;

  const last = await tx.incident.findFirst({
    where: { ddsSeatId: seat.id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  if (last) {
    const wait = settings.tempoSec - (now.getTime() - last.createdAt.getTime()) / 1000;
    if (wait > 0) return { ...base, nextCardInSec: seat.dealtOutAt ? null : Math.ceil(wait) };
  }
  if (seat.dealtOutAt && now.getTime() - (lookedInVain.get(seat.id) ?? seat.dealtOutAt.getTime()) < DEALT_OUT_RETRY_MS) return base;

  const draw = await drawCard(tx, seat, settings, adaptiveChoice(seat.lesson.settings));
  if (!draw.scenario) {
    await markDealtOut(tx, seat, now);
    if (lookedInVain.size > 5_000) lookedInVain.clear();
    lookedInVain.set(seat.id, now.getTime());
    return draw.pool ? { ...base, exhausted: true } : { ...base, noScenarios: true, exhausted: false };
  }
  lookedInVain.delete(seat.id);
  await createCard(tx, seat, draw.scenario, now);
  // The last of the place's tasks is dealt: the board and the place learn it at once, not a tempo later.
  await markDealtOut(tx, seat, draw.left ? null : now);
  const next = queue + 1 >= settings.maxQueue || !draw.left ? null : settings.tempoSec;
  return { ...base, queue: queue + 1, nextCardInSec: next, exhausted: !draw.left };
}

/** Seat.dealtOutAt: set once when the place runs out of tasks, cleared when something new comes up. */
async function markDealtOut(tx: Tx, seat: Pick<Seat, "id" | "dealtOutAt">, at: Date | null) {
  if (at ? !seat.dealtOutAt : seat.dealtOutAt) await tx.seat.update({ where: { id: seat.id }, data: { dealtOutAt: at } });
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
  learningMeta: true,
} satisfies Prisma.ScenarioSelect;

type PickedScenario = Prisma.ScenarioGetPayload<{ select: typeof scenarioSelect }>;

const ownSelect = { id: true, shortName: true, okrug: true, district: true } satisfies Prisma.ServiceSelect;
type OwnService = Prisma.ServiceGetPayload<{ select: typeof ownSelect }>;

export type Draw = {
  scenario: PickedScenario | null;
  /** How many scenarios the place can get in this lesson at all; 0 — nothing to deal from the start. */
  pool: number;
  /** How many are left after this one; 0 — every task of the place has come. */
  left: number;
};

/** The next scenario for a ДДС place, or null when it has had them all (see drawCard). */
export async function pickScenario(tx: Tx, seat: Seat, settings: LessonSettings, adaptive: boolean): Promise<PickedScenario | null> {
  return (await drawCard(tx, seat, settings, adaptive)).scenario;
}

/**
 * The next card of a ДДС place. Every task and every scenario comes to a place once per lesson: tasks assigned by the
 * teacher in their order, otherwise an approved scenario of the lesson's categories and location — near the student's
 * level when the lesson is adaptive (src/lib/adaptive), at random when it is not. A ticket and its variant with an error
 * in the card show the same card, so a place drawing by itself gets only one of the two (scenarios/pairs.ts). When
 * nothing new is left, nothing comes: the place and the board say so.
 *
 * A district or prefecture place gets cards of its territory (dds/territory.ts): first the situations that happen there,
 * then situations whose house can move there — with the reference entry of its level first; a scenario that can neither
 * be there nor move there is not drawn for it. In a lesson of mixed cards the situations of the 112 places come from them
 * and are never generated (lessons/in-play.ts).
 */
export async function drawCard(tx: Tx, seat: Seat, settings: LessonSettings, adaptive: boolean): Promise<Draw> {
  const assigned = seat.scenarioIds.length > 0;
  const where: Prisma.ScenarioWhereInput = { status: "APPROVED" };
  if (assigned) where.id = { in: seat.scenarioIds };
  else if (settings.categories.length) where.category = { in: settings.categories };

  // A scenario without a ДДС card (a silent line, a call that breaks off) is a task for the 112 place only.
  const candidates = await tx.scenario.findMany({ where, select: scenarioSelect });
  const allowedControl = new Set<string>();
  for (const s of candidates.filter((row) => assigned && isControl(row.learningMeta))) {
    if (await canIssueControl(tx, seat.lessonId, seat.studentId, s.id)) allowedControl.add(s.id);
  }
  const withCard = candidates.filter((s) => s.ddsCard !== null
    && (!isControl(s.learningMeta) || allowedControl.has(s.id)));
  const own = seat.serviceId ? await tx.service.findUnique({ where: { id: seat.serviceId }, select: ownSelect }) : null;
  const territory = own ? territoryOf(own) : null;
  const located = inLessonLocation(withCard, seat, settings);
  // A territorial place draws only what it can get on its territory; tasks marked by hand come as they are.
  const fit = territory && !assigned ? located.filter((s) => onTerritory(s, territory) !== "no") : located;
  const at112 = settings.cardSource === "mixed" ? withPairs(await takenAt112(tx, seat.lessonId), withCard) : new Set<string>();
  const pool = fit.filter((s) => !at112.has(s.id));

  const feed = await tx.incident.findMany({
    where: seatFeedWhere(seat, settings),
    select: { scenarioId: true, createdAt: true, scenario: { select: { ticketRef: true } } },
  });
  // Dealt to the place or come from a 112 place: never again in this lesson, nor the other half of its pair.
  const had = feed.flatMap((i) => (i.scenarioId ? [{ id: i.scenarioId, ticketRef: i.scenario?.ticketRef }] : []));
  const used = new Set(had.map((h) => h.id));
  const unseen = pool.filter((s) => !used.has(s.id));
  const fresh = assigned ? unseen : withoutPairsOf(unseen, had);
  if (!fresh.length) return { scenario: null, pool: fit.length, left: 0 };

  let scenario: PickedScenario;
  if (assigned) {
    const order = new Map(seat.scenarioIds.map((id, i) => [id, i]));
    scenario = [...fresh].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))[0];
  } else {
    // In a lesson of generated cards a situation busy at a 112 place waits while there is another.
    const busy = settings.cardSource === "generated" ? withPairs(await inPlayAt112(tx, seat.lessonId), withCard) : new Set<string>();
    const free = preferNotInPlay(fresh, busy);
    const wanted = territory ? byTerritory(free, territory, own!) : await preferReaching(tx, own, free);
    if (adaptive) {
      const level = await studentRating(seat.studentId, "DDS", tx);
      scenario = pickAdaptive(wanted, { target: level.difficulty }) ?? wanted[0];
    } else {
      scenario = wanted[Math.floor(Math.random() * wanted.length)];
    }
  }
  const left = assigned ? fresh.length - 1 : withoutPairsOf(fresh.filter((s) => s.id !== scenario.id), [scenario]).length;
  return { scenario, pool: fit.length, left };
}

/** «in» — the scenario happens on the territory; «move» — its house can move there; «no» — neither. */
function onTerritory(s: PickedScenario, t: Territory): "in" | "move" | "no" {
  const spec = ddsCardOf(s);
  if (territoryMatch(placeOfAddress(spec.address), t) === "in") return "in";
  return movable(spec) && hasStreets(t) ? "move" : "no";
}

/**
 * A territorial place: first the situations that happen on its territory, then those that move there with a reference
 * entry of its level (its decision and crew are judged), then the rest that move.
 */
function byTerritory(pool: PickedScenario[], t: Territory, own: OwnService): PickedScenario[] {
  const inside = pool.filter((s) => onTerritory(s, t) === "in");
  if (inside.length) return inside;
  const withEntry = pool.filter((s) => hasOwnReference(s.ddsReference, own));
  return withEntry.length ? withEntry : pool;
}

/**
 * First the situations whose reference has an entry for the place's service: only there the place's decision and crew
 * are judged. Then those whose card carries the place's service; all of them when there are none (the teacher chose,
 * say, only «медицина»).
 */
async function preferReaching(tx: Tx, own: OwnService | null, pool: PickedScenario[]): Promise<PickedScenario[]> {
  if (!own) return pool;
  const withEntry = pool.filter((s) => hasOwnReference(s.ddsReference, own));
  if (withEntry.length) return withEntry;
  const specs = pool.map((scenario) => ({ scenario, spec: ddsCardOf(scenario) }));
  const ids = [...new Set(specs.flatMap((x) => x.spec.services))];
  const names = new Map((ids.length ? await tx.service.findMany({ where: { id: { in: ids } }, select: { id: true, shortName: true } }) : []).map((r) => [r.id, r.shortName]));
  const reaching = specs
    .filter(({ spec }) => reachesPlace(spec.services.length ? spec.services.map((id) => names.get(id) ?? "") : spec.serviceNames, own))
    .map((x) => x.scenario);
  return reaching.length ? reaching : pool;
}

type PlateRow = { id: number; shortName: string; okrug: string | null; district: string | null };

async function createCard(tx: Tx, seat: Seat, scenario: PickedScenario, now: Date) {
  let spec = ddsCardOf(scenario);
  // One caller per situation in the lesson, as at the 112 places: the tickets reuse names and numbers (op112/identity.ts).
  const persona = personaOf(scenario);
  const repeat = (scenario.truth as { repeatOf?: unknown } | null)?.repeatOf;
  if (persona && spec.caller.fullName && !repeat) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`lesson-callers:${seat.lessonId}`}))`;
    const phone = spec.caller.aon ?? spec.caller.provided;
    const own = distinctCaller({ ...persona, fullName: spec.caller.fullName, phone }, situationOf(scenario), seat.lessonId, await lessonCallers(tx, seat.lessonId));
    spec = {
      ...spec,
      caller: {
        ...spec.caller,
        fullName: own.fullName,
        ...(spec.caller.aon ? { aon: own.phone } : {}),
        ...(spec.caller.provided ? { provided: own.phone } : {}),
      },
    };
  }
  const select = { id: true, shortName: true, okrug: true, district: true } as const;
  const own = await tx.service.findUnique({ where: { id: seat.serviceId! }, select });
  if (!own) return;
  // A district or prefecture place gets the card on its territory: the house moves there when it can (territory.ts),
  // never onto a house of another card in its feed — two incidents on one house would read as a duplicate.
  const feedHouses = new Set(
    (await tx.incident.findMany({ where: { ddsSeatId: seat.id }, select: { address: true } })).map((i) => {
      const a = (i.address ?? {}) as { street?: string; house?: string };
      return houseKey(a.street, a.house);
    }),
  );
  const { move, foreign } = moveFor(spec, scenario.id, own, feedHouses);
  if (move) spec = moveCard(spec, move);

  const listed = spec.services.length
    ? await tx.service.findMany({ where: { id: { in: spec.services } }, select })
    : await tx.service.findMany({ where: { shortName: { in: spec.serviceNames } }, select });
  // Keep the scenario's order of plates; unknown ids or names are skipped.
  const ordered = (spec.services.length ? spec.services.map((id) => listed.find((s) => s.id === id)) : spec.serviceNames.map((n) => listed.find((s) => s.shortName === n)))
    .filter((s): s is PlateRow => !!s);
  // The district and prefecture plates follow the new address; own plate is always on the card (#684).
  const around = move ? await tx.service.findMany({ where: { okrug: move.okrug }, select }) : [];
  const plates = platesFor(ordered, own, { move, foreign, around });
  const serviceIds = [...new Set(plates.map((s) => s.id))];
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
