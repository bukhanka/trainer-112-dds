/** Grading a saved 112 card: rule checks at once, model checks afterwards, one Attempt per card. */
import type { Prisma } from "@prisma/client";
import { aiOffNote } from "@/lib/ai/provider";
import { db } from "@/lib/db";
import { attemptSituation, loadGuidance } from "@/lib/review/corrections-db";
import { computeScore, WEIGHT_GROUPS, type CriterionResult, type Weights } from "@/lib/scoring/score";
import type { IncidentAddress, IncidentCaller, IncidentFlags } from "@/lib/incident/types";
import { tagsToAnswers } from "./card";
import type { Persona } from "./caller";
import {
  AI_CODES,
  aiEnabled,
  aiUnavailable,
  evaluateOp112Ai,
  evaluateOp112Rules,
  normalizeTruth,
  phonePlates,
  referenceLeaves,
  type EvalInput,
} from "./evaluate";
import { LINK_CODES, linkCheck } from "./links";
import { lessonCards } from "./links-db";
import { PHONE_CODE, phoneCheck, phoneNotices, readWorkLog, type PhoneCall } from "./workoffs";
import { regionOf, treesFor, typeNames } from "./panels";
import { lessonSettings } from "./seat";
import { serviceCatalog } from "./services";
import { selectServicesFromDb } from "@/lib/routing/engine";
import type { CallLine, StoredTag } from "./types";

/** How an empty card is labelled in the journal, as on the customer's workstation. */
export const EMPTY_TEXT = { noContact: "<Нет контакта>", dropped: "<Срыв связи>" } as const;

export async function activeWeights(): Promise<Weights> {
  const profile = await db.weightProfile.findFirst({ where: { isActive: true }, orderBy: { updatedAt: "desc" } });
  const raw = (profile?.weights ?? {}) as Record<string, unknown>;
  const weights = {} as Weights;
  for (const g of Object.keys(WEIGHT_GROUPS) as (keyof Weights)[]) {
    const v = Number(raw[g]);
    weights[g] = Number.isFinite(v) ? v : 1;
  }
  return weights;
}

/** Flags the chosen panels can set: rows with a flag and buttons that switch one on. */
function settableFlags(trees: Record<string, { rows: { flag?: string; options?: { flag?: string }[] }[] }>): string[] {
  const out = new Set<string>();
  for (const tree of Object.values(trees)) {
    for (const row of tree.rows) {
      if (row.flag) out.add(row.flag);
      for (const o of row.options ?? []) if (o.flag) out.add(o.flag);
    }
  }
  return [...out];
}

/** Everything the checks need, loaded from the database. */
export async function loadEvalInput(incidentId: string): Promise<{ input: EvalInput; lessonId: string; seatId: string; studentId: string; scenarioId: string | null } | null> {
  const incident = await db.incident.findUnique({
    where: { id: incidentId },
    include: {
      services: true,
      scenario: true,
      calls: { where: { kind: { in: ["CALLER_IN", "SERVICE_OUT"] } }, orderBy: { startedAt: "desc" } },
      linkedTo: { select: { id: true, number: true } },
    },
  });
  if (!incident?.createdBySeatId || !incident.lessonId) return null;
  const seat = await db.seat.findUnique({ where: { id: incident.createdBySeatId }, include: { lesson: true } });
  if (!seat) return null;
  const { cards } = tagsToAnswers(incident.tags);
  const call = incident.calls.find((c) => c.kind === "CALLER_IN");
  const flags = (incident.flags ?? {}) as IncidentFlags;
  const catalog = await serviceCatalog();
  const truth = normalizeTruth(incident.scenario?.truth, catalog);
  // Reference plates: the scenario's own list, or what the engine picks for the leaves they follow — the main
  // leaf, or the accepted alternative the trainee chose (same flags and true address of the scenario).
  const leaves = truth ? referenceLeaves(truth, incident.typeCodes) : null;
  const expectedServices =
    truth && leaves && !leaves.alternative && truth.services.length
      ? truth.services
      : truth && leaves?.codes.length
        ? (
            await selectServicesFromDb({
              typeCodes: leaves.codes,
              flags: truth.flags,
              district: truth.address.district ?? null,
              okrug: truth.address.okrug ?? null,
              region: regionOf(truth.address),
            })
          ).map((p) => p.serviceId)
        : [];
  const input: EvalInput = {
    card: {
      caller: (incident.caller ?? {}) as IncidentCaller,
      address: (incident.address ?? {}) as IncidentAddress,
      flags,
      tags: (Array.isArray(incident.tags) ? incident.tags : []) as StoredTag[],
      cards,
      typeCodes: incident.typeCodes,
      description: incident.description ?? "",
      openedAt: incident.openedAt,
      savedAt: incident.savedAt,
      empty: incident.status === "empty" ? (incident.description === EMPTY_TEXT.dropped ? "dropped" : "noContact") : undefined,
    },
    serviceIds: incident.services.map((s) => s.serviceId),
    persona: (incident.scenario?.caller ?? null) as Persona | null,
    truth,
    expectedServices,
    expectedServicesBy: leaves?.alternative ? (await typeNames(leaves.codes))[leaves.codes[0]] : undefined,
    messages: (Array.isArray(call?.messages) ? call.messages : []) as CallLine[],
    typingSec: lessonSettings(seat).typingSec,
    catalog,
    typeNames: await typeNames([...incident.typeCodes, ...(truth?.typeCodes ?? [])]),
    settableFlags: settableFlags(await treesFor(cards)),
  };
  // «Совпадение»: the link and, for a repeat call, the cards of the first call in this lesson.
  input.link = incident.linkedTo;
  if (truth?.repeatOf) {
    input.repeatCards = (await lessonCards(incident.lessonId, incident.id))
      .filter((c) => c.scenarioRef === truth.repeatOf)
      .map((c) => ({ id: c.ref.id, number: c.ref.number, place: c.ref.place }));
  }
  // The calls to the services working by phone are made after «сохранить»: they are judged at «отработана».
  if (incident.status === "worked") {
    const calls = incident.calls.filter((c) => c.kind === "SERVICE_OUT").map(phoneCallOf).filter((c): c is PhoneCall => c !== null);
    input.phoneNotices = phoneNotices(phonePlates(input), calls, readWorkLog(incident.workLog));
  }
  return { input, lessonId: incident.lessonId, seatId: seat.id, studentId: seat.studentId, scenarioId: incident.scenarioId };
}

/** A call from the work-off row, as the phone check reads it. */
export function phoneCallOf(call: { id: string; counterpart: unknown; messages: unknown; startedAt: Date }): PhoneCall | null {
  const cp = (call.counterpart ?? {}) as { serviceId?: number; duty?: string };
  if (typeof cp.serviceId !== "number") return null;
  return {
    id: call.id,
    serviceId: cp.serviceId,
    duty: cp.duty ?? "",
    at: call.startedAt.toISOString(),
    messages: (Array.isArray(call.messages) ? call.messages : []) as CallLine[],
  };
}

/**
 * «отработана»: the checks of what is done after saving — the calls to the services working by phone, and a link
 * made in the view mode («Кнопка доступна как в режиме создания карточки, так и в режиме просмотра»). Only these
 * checks change: the card itself was graded as it was sent to the services.
 */
export async function regradeAfterWork(incidentId: string): Promise<void> {
  try {
    const loaded = await loadEvalInput(incidentId);
    if (!loaded) return;
    const { input } = loaded;
    const fresh = [
      phoneCheck(phonePlates(input), input.phoneNotices ?? null),
      input.card.empty ? null : linkCheck({ repeatOf: input.truth?.repeatOf, link: input.link ?? null, repeatCards: input.repeatCards ?? [] }),
    ].filter((c): c is CriterionResult => c !== null);
    const replaced = new Set<string>([PHONE_CODE, ...LINK_CODES]);
    const attempt = await db.attempt.findFirst({ where: { incidentId, kind: "OP112" }, orderBy: { createdAt: "desc" } });
    if (!attempt) return;
    const criteria = [...((attempt.criteria ?? []) as unknown as CriterionResult[]).filter((c) => !replaced.has(c.code)), ...fresh];
    const score = computeScore(criteria, await activeWeights(), attempt.override as Record<string, boolean | null> | null);
    await db.attempt.update({ where: { id: attempt.id }, data: { criteria: criteria as unknown as Prisma.InputJsonValue, score } });
  } catch (err) {
    console.error("op112 after-work checks failed", incidentId, err);
  }
}

/**
 * Create the Attempt for a saved card. Model checks, if any, are left pending for runAiReview.
 * If the checks themselves fail, the attempt still appears (with a note), so the review never hangs.
 */
export async function gradeIncident(incidentId: string): Promise<{ attemptId: string; aiPending: boolean } | null> {
  try {
    return await grade(incidentId);
  } catch (err) {
    console.error("op112 grading failed", incidentId, err);
    const incident = await db.incident.findUnique({ where: { id: incidentId }, select: { lessonId: true, createdBySeatId: true, scenarioId: true } });
    const seat = incident?.createdBySeatId ? await db.seat.findUnique({ where: { id: incident.createdBySeatId } }) : null;
    if (!incident?.lessonId || !seat) return null;
    const note: CriterionResult[] = [
      { code: "op112.grading", group: "completeness", title: "Автоматическая проверка не выполнилась", ok: null, evidence: "Оценку поставит преподаватель", source: "rule" },
    ];
    const attempt = await db.attempt.create({
      data: { lessonId: incident.lessonId, seatId: seat.id, studentId: seat.studentId, kind: "OP112", incidentId, scenarioId: incident.scenarioId, criteria: note as unknown as Prisma.InputJsonValue, score: null },
    });
    return { attemptId: attempt.id, aiPending: false };
  }
}

async function grade(incidentId: string): Promise<{ attemptId: string; aiPending: boolean } | null> {
  const loaded = await loadEvalInput(incidentId);
  if (!loaded) return null;
  const { input } = loaded;
  const rules = evaluateOp112Rules(input);
  const aiPending = aiEnabled() && !input.card.empty;
  const criteria: CriterionResult[] = [...rules, ...(aiPending || input.card.empty ? [] : aiUnavailable(`ИИ-проверка не выполнялась: ${aiOffNote()}`))];
  const score = computeScore(criteria, await activeWeights());
  const attempt = await db.attempt.create({
    data: {
      lessonId: loaded.lessonId,
      seatId: loaded.seatId,
      studentId: loaded.studentId,
      kind: "OP112",
      incidentId,
      scenarioId: loaded.scenarioId,
      criteria: criteria as unknown as Prisma.InputJsonValue,
      score,
    },
  });
  return { attemptId: attempt.id, aiPending };
}

/** Add the model's checks to an Attempt and recompute its score. Never throws. */
export async function runAiReview(attemptId: string): Promise<void> {
  try {
    const attempt = await db.attempt.findUnique({ where: { id: attemptId } });
    if (!attempt?.incidentId) return;
    const loaded = await loadEvalInput(attempt.incidentId);
    if (!loaded) return;
    // The teachers' corrections of these checks in similar situations (учёт правок, src/lib/review/corrections.ts).
    const situation = await attemptSituation(db, attemptId);
    const ctx = situation ?? { scenarioId: loaded.scenarioId, typeCode: null, typeGroupId: null, category: null };
    const [said, description] = await Promise.all([loadGuidance("op112.ai.said", ctx), loadGuidance("op112.ai.description", ctx)]);
    const ai = await evaluateOp112Ai(loaded.input, { ctx, said, description });
    // Read again: «отработана» may have updated the phone check while the model was thinking.
    const fresh = (await db.attempt.findUnique({ where: { id: attemptId } })) ?? attempt;
    const base = ((fresh.criteria ?? []) as unknown as CriterionResult[]).filter((c) => !(AI_CODES as readonly string[]).includes(c.code));
    const criteria = [...base, ...ai];
    const score = computeScore(criteria, await activeWeights(), fresh.override as Record<string, boolean | null> | null);
    await db.attempt.update({ where: { id: attemptId }, data: { criteria: criteria as unknown as Prisma.InputJsonValue, score } });
  } catch (err) {
    // The rule checks stay; the model checks are marked as not done so the review stops waiting.
    console.error("op112 ai review failed", attemptId, err);
    const attempt = await db.attempt.findUnique({ where: { id: attemptId } }).catch(() => null);
    if (!attempt) return;
    const base = ((attempt.criteria ?? []) as unknown as CriterionResult[]).filter((c) => !(AI_CODES as readonly string[]).includes(c.code));
    const criteria = [...base, ...aiUnavailable("ИИ-проверка не удалась")];
    await db.attempt.update({ where: { id: attemptId }, data: { criteria: criteria as unknown as Prisma.InputJsonValue } }).catch(() => undefined);
  }
}

/** State of the model checks, read from the checks themselves (Attempt.aiDraft belongs to the teacher's review). */
export function aiState(criteria: CriterionResult[]): "pending" | "done" | "failed" | "off" {
  const ai = criteria.filter((c) => (AI_CODES as readonly string[]).includes(c.code));
  if (!ai.length) return aiEnabled() ? "pending" : "off";
  if (ai.some((c) => c.ok !== null)) return "done";
  return ai.some((c) => /не настроена/.test(c.evidence ?? "")) ? "off" : "failed";
}
