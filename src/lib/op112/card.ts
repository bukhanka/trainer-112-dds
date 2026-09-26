/** What the filled panels mean: classifier leaves, routing flags and the tag line stored on Incident. */
import type { IncidentFlags } from "@/lib/incident/types";
import { resolveTree } from "@/lib/routing/tags";
import { findKind, kindTitle, panelFor, picked, visibleRows, type TagTree } from "./catalog";
import type { CardAnswers, StoredTag } from "./types";

/** Flags the top buttons of the card set directly; the panels add the rest. */
export const TOP_FLAGS = ["victims", "refusedAmbulance", "noAccess"] as const;

export type ResolvedCard = {
  typeCodes: number[];
  /** «задымление» twins of the chosen leaves, accepted as an equally right classification */
  smokeTypeCodes: number[];
  flags: IncidentFlags;
  tags: StoredTag[];
};

/**
 * Chosen kinds and panel answers → leaves, flags and tags. `trees` carries the signs panels
 * (built from classifier leaves); hand-made and plain panels are found by name.
 */
export function resolveCard(
  cards: string[],
  answers: Record<string, CardAnswers>,
  top: IncidentFlags,
  trees: Record<string, TagTree> = {},
): ResolvedCard {
  const typeCodes: number[] = [];
  const smokeTypeCodes: number[] = [];
  const flags: IncidentFlags = {};
  const tags: StoredTag[] = [];
  for (const card of cards) {
    const tree = trees[card] ?? panelFor(card);
    const a = answers[card] ?? {};
    const r = resolveTree(tree, a);
    const codes = r.typeCodes.length ? r.typeCodes : (findKind(card)?.typeCodes ?? []);
    for (const c of codes) if (!typeCodes.includes(c)) typeCodes.push(c);
    for (const c of r.smokeTypeCodes) if (!smokeTypeCodes.includes(c)) smokeTypeCodes.push(c);
    for (const [k, v] of Object.entries(r.flags) as [keyof IncidentFlags, boolean][]) {
      if (v) flags[k] = true;
      else if (flags[k] === undefined) flags[k] = false;
    }
    const before = tags.length;
    for (const row of visibleRows(tree, a)) {
      const values = picked(a, row.id);
      if (!values.length) continue;
      if (row.kind === "text") {
        const text = values.join(" ").trim();
        tags.push({ card, rowId: row.id, row: row.label, value: `${row.label}: ${text}`, text });
      } else for (const value of values) tags.push({ card, rowId: row.id, row: row.label, value });
    }
    // A kind with nothing chosen yet still has to survive a reload of the draft.
    if (tags.length === before) tags.push({ card, rowId: "_kind", row: "Что случилось", value: kindTitle(card) });
  }
  for (const k of TOP_FLAGS) if (top[k]) flags[k] = true;
  return { typeCodes, smokeTypeCodes, flags, tags };
}

/** Stored tags → the kinds and answers the workstation shows again. */
export function tagsToAnswers(raw: unknown): { cards: string[]; answers: Record<string, CardAnswers> } {
  const cards: string[] = [];
  const answers: Record<string, CardAnswers> = {};
  if (!Array.isArray(raw)) return { cards, answers };
  for (const t of raw as Partial<StoredTag>[]) {
    if (!t || typeof t.card !== "string" || typeof t.rowId !== "string" || typeof t.value !== "string") continue;
    if (!cards.includes(t.card)) cards.push(t.card);
    if (t.rowId === "_kind" || t.rowId === "_type") continue;
    const a = (answers[t.card] ??= {});
    (a[t.rowId] ??= []).push(typeof t.text === "string" ? t.text : t.value);
  }
  return { cards, answers };
}

/** Which flags come from panel rows, so the top buttons can be restored without them. */
export function rowFlagIds(answers: Record<string, CardAnswers>): Set<string> {
  const ids = new Set<string>();
  for (const a of Object.values(answers)) {
    if (picked(a, "access").length || picked(a, "flag_noAccess").length) ids.add("noAccess");
  }
  return ids;
}
