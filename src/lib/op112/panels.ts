/** Server side of the panels: classifier leaves from the database, signs panels, resolving a draft. */
import { db } from "@/lib/db";
import type { IncidentAddress, IncidentFlags } from "@/lib/incident/types";
import { selectServicesFromDb } from "@/lib/routing/engine";
import { needsLeaves, panelFor, type LeafType, type TagTree } from "./catalog";
import { resolveCard, type ResolvedCard } from "./card";
import type { CardAnswers, RoutedService } from "./types";

const TTL_MS = 5 * 60_000;
let leavesCache: { at: number; list: LeafType[] } | null = null;

export async function leafTypes(): Promise<LeafType[]> {
  if (leavesCache && Date.now() - leavesCache.at < TTL_MS) return leavesCache.list;
  const list = await db.incidentType.findMany({
    select: { code: true, groupId: true, subgroup: true, sign1: true, sign2: true, sign3: true, finalType: true, hiddenFromOperator: true },
    orderBy: { code: "asc" },
  });
  leavesCache = { at: Date.now(), list };
  return list;
}

/** Panels of the chosen kinds; signs panels are built from the classifier in the database. */
export async function treesFor(cards: string[]): Promise<Record<string, TagTree>> {
  const out: Record<string, TagTree> = {};
  const leaves = cards.some(needsLeaves) ? await leafTypes() : [];
  for (const card of cards) out[card] = panelFor(card, leaves);
  return out;
}

export type DraftCore = {
  cards: string[];
  answers: Record<string, CardAnswers>;
  flags: IncidentFlags;
  address: IncidentAddress;
};

export async function resolveDraft(d: DraftCore): Promise<ResolvedCard> {
  return resolveCard(d.cards, d.answers, d.flags, await treesFor(d.cards));
}

/** Region for the routing engine: a subject outside Moscow («Московская область»). */
export function regionOf(address: IncidentAddress): string | null {
  const s = address.subject?.trim();
  return s && !/^(г\.?\s*)?москва$/i.test(s) ? s : null;
}

/** Plates the system picks: the classifier routes for the chosen leaves, flags and territory. */
export async function routeDraft(d: DraftCore, resolved?: ResolvedCard): Promise<RoutedService[]> {
  const r = resolved ?? (await resolveDraft(d));
  if (!r.typeCodes.length) return [];
  const picked = await selectServicesFromDb({
    typeCodes: r.typeCodes,
    flags: r.flags,
    district: d.address.district ?? null,
    okrug: d.address.okrug ?? null,
    region: regionOf(d.address),
  });
  return picked.map((p) => ({ serviceId: p.serviceId, isMain: p.isMain, auto: true }));
}

/** «Класс.» names of classifier leaves. */
export async function typeNames(codes: number[]): Promise<Record<number, string>> {
  if (!codes.length) return {};
  const rows = await db.incidentType.findMany({ where: { code: { in: codes } }, select: { code: true, finalType: true } });
  return Object.fromEntries(rows.map((r) => [r.code, r.finalType]));
}
