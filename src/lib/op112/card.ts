/** Conversions between the questionnaire answers, routing flags and what is stored on Incident. */
import type { IncidentFlags } from "@/lib/incident/types";
import { questionCard, rowVisible, whatHappened } from "./catalog";
import type { CardAnswers, StoredTag } from "./types";

/** Flags the top buttons set directly; questionnaire rows add the rest. */
export const TOP_FLAGS = ["victims", "refusedAmbulance", "noAccess"] as const;

export function deriveFlags(top: IncidentFlags, cards: string[], answers: Record<string, CardAnswers>): IncidentFlags {
  const flags: IncidentFlags = {};
  for (const key of TOP_FLAGS) if (top[key]) flags[key] = true;
  for (const cardKey of cards) {
    const card = questionCard(cardKey);
    const a = answers[cardKey] ?? {};
    for (const row of card.rows) {
      if (!row.flag || !rowVisible(row, a)) continue;
      const v = a[row.id] ?? [];
      if (row.kind === "toggle") {
        if (v.length) flags[row.flag] = true;
      } else if (v.includes("Да")) flags[row.flag] = true;
      else if (v.includes("Нет") && flags[row.flag] === undefined) flags[row.flag] = false;
    }
  }
  return flags;
}

/** Flat tag list for Incident.tags; the first tag of each card names the card. */
export function answersToTags(cards: string[], answers: Record<string, CardAnswers>): StoredTag[] {
  const tags: StoredTag[] = [];
  for (const cardKey of cards) {
    const card = questionCard(cardKey);
    tags.push({ card: cardKey, rowId: "_type", row: "Что случилось", value: whatHappened(cardKey)?.chip ?? card.title });
    const a = answers[cardKey] ?? {};
    for (const row of card.rows) {
      if (!rowVisible(row, a)) continue;
      for (const value of a[row.id] ?? []) {
        if (value.trim()) tags.push({ card: cardKey, rowId: row.id, row: row.label, value: value.trim() });
      }
    }
  }
  return tags;
}

export function tagsToAnswers(raw: unknown): { cards: string[]; answers: Record<string, CardAnswers> } {
  const cards: string[] = [];
  const answers: Record<string, CardAnswers> = {};
  if (!Array.isArray(raw)) return { cards, answers };
  for (const t of raw as Partial<StoredTag>[]) {
    if (!t || typeof t.card !== "string" || typeof t.rowId !== "string" || typeof t.value !== "string") continue;
    if (!cards.includes(t.card)) cards.push(t.card);
    if (t.rowId === "_type") continue;
    const a = (answers[t.card] ??= {});
    (a[t.rowId] ??= []).push(t.value);
  }
  return { cards, answers };
}

/** «Улица · Открытое пламя / Дым · Мусор» — how the ДДС sees the chosen tags. */
export function tagLine(tags: StoredTag[]): string {
  return tags
    .filter((t) => t.rowId !== "text")
    .map((t) => t.value)
    .join(" · ");
}
