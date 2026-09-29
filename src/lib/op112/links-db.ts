/** Database side of card links: the lesson's saved cards, matches, linking to a main card. */
import type { Incident } from "@prisma/client";
import { db } from "@/lib/db";
import type { IncidentAddress, IncidentCaller } from "@/lib/incident/types";
import { tagsToAnswers } from "./card";
import { kindTitle } from "./catalog";
import { addressLine } from "./gazetteer";
import type { CardRef } from "./links";
import { situationOf } from "@/lib/scenarios/pairs";

export type LessonCard = {
  ref: CardRef;
  caller: IncidentCaller;
  address: IncidentAddress;
  mainId: string | null;
  scenarioRef: string | null;
  /** The situation the card was made of (scenarios/pairs.ts): a ticket and its variant are one. */
  situation: string | null;
};

/** «ул. Грина, д. 11 (ЮЗАО, Северное Бутово)» — the address line of a card with its territory. */
export function placeOf(address: IncidentAddress): string {
  const line = addressLine(address) || address.descriptive || address.object || "адрес не заполнен";
  const area = [address.okrug, address.district].filter(Boolean).join(", ");
  return area ? `${line} (${area})` : line;
}

/**
 * What «Совпадение» and «создать связь» look through: cards saved at the 112 places of the lesson. The cards the
 * system deals to ДДС places by itself (source «generated», «оп. 0») were never taken by an operator here.
 */
export function lessonCardsWhere(lessonId: string, exceptId?: string) {
  return { lessonId, source: "op112", status: { in: ["registered", "worked"] }, ...(exceptId ? { id: { not: exceptId } } : {}) };
}

/** Saved cards of the lesson's 112 places, newest first. */
export async function lessonCards(lessonId: string, exceptId?: string): Promise<LessonCard[]> {
  const rows = await db.incident.findMany({
    where: lessonCardsWhere(lessonId, exceptId),
    orderBy: { savedAt: "desc" },
    take: 60,
    select: {
      id: true,
      number: true,
      savedAt: true,
      status: true,
      address: true,
      caller: true,
      tags: true,
      operatorNo: true,
      armNo: true,
      linkedToId: true,
      linkedTo: { select: { number: true } },
      scenario: { select: { id: true, ticketRef: true } },
    },
  });
  return rows.map((r) => {
    const address = (r.address ?? {}) as IncidentAddress;
    return {
      ref: {
        id: r.id,
        number: r.number,
        savedAt: r.savedAt?.toISOString() ?? null,
        place: placeOf(address),
        kinds: tagsToAnswers(r.tags).cards.map(kindTitle).join(", "),
        operator: `оп. ${r.operatorNo ?? "—"}, АРМ ${r.armNo ?? "—"}`,
        status: r.status,
        mainNumber: r.linkedTo?.number ?? null,
      },
      caller: (r.caller ?? {}) as IncidentCaller,
      address,
      mainId: r.linkedToId,
      scenarioRef: r.scenario?.ticketRef ?? null,
      situation: r.scenario ? situationOf(r.scenario) : null,
    };
  });
}

/**
 * Link a card to another of the same lesson; `to = null` unlinks. The link always goes to a main card: a
 * subordinate one passes it on to its own main. A card other cards are linked to stays main.
 */
export async function linkCard(
  incident: Pick<Incident, "id" | "lessonId" | "status">,
  to: string | null,
): Promise<{ ok: true; main: { id: string; number: number } | null } | { ok: false; error: string }> {
  if (!["draft", "registered"].includes(incident.status)) return { ok: false, error: "card_closed" };
  if (!to) {
    await db.incident.update({ where: { id: incident.id }, data: { linkedToId: null } });
    return { ok: true, main: null };
  }
  if (to === incident.id) return { ok: false, error: "self" };
  const target = await db.incident.findUnique({ where: { id: to }, select: { id: true, number: true, lessonId: true, status: true, linkedTo: { select: { id: true, number: true } } } });
  if (!target || target.lessonId !== incident.lessonId || !["registered", "worked"].includes(target.status)) return { ok: false, error: "not_found" };
  const main = target.linkedTo ?? { id: target.id, number: target.number };
  if (main.id === incident.id) return { ok: false, error: "self" };
  if (await db.incident.count({ where: { linkedToId: incident.id } })) return { ok: false, error: "has_linked" };
  await db.incident.update({ where: { id: incident.id }, data: { linkedToId: main.id } });
  return { ok: true, main };
}
