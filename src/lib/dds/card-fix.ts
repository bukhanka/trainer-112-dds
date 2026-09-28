/**
 * The 112 operator corrects an error in the card on the ДДС dispatcher's call (customer's answer of 27.09): the
 * dispatcher does not edit the fields of the 112 card, the operator does. The correction is made only when the
 * dispatcher has named the card number and the right information — the same facts the review wants from that call
 * (evaluate.ts, «Об ошибке в карточке сообщено в 112») — and it leaves a line in the card's journal of descriptions,
 * so every service on the card sees what changed and who changed it. Pure: the phone applies it in a transaction.
 */
import type { DescriptionEntry, IncidentAddress, IncidentFlags } from "@/lib/incident/types";
import type { CardError } from "./scenario";

/** Author of the operator's line in the journal of the card. */
export const OPERATOR_112_AUTHOR = "оп. 112";
const NOTE = "Изменено оператором 112";

const readLog = (raw: unknown): DescriptionEntry[] => (Array.isArray(raw) ? (raw as DescriptionEntry[]) : []);

/** The card already carries the operator's correction. */
export function cardErrorFixed(descriptionLog: unknown): boolean {
  return readLog(descriptionLog).some((e) => e?.author === OPERATOR_112_AUTHOR && typeof e.text === "string" && e.text.startsWith(NOTE));
}

const PART: Record<string, string> = { house: "дом", building: "корпус", structure: "строение", entrance: "подъезд", floor: "этаж", flat: "квартира" };

/** What was corrected, in words: «подъезд 5», «есть пострадавшие»; the reference's own words when it has no fields. */
export function fixLabel(error: CardError): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(error.fix?.address ?? {})) if (value && PART[key]) parts.push(`${PART[key]} ${value}`);
  const victims = error.fix?.flags.victims;
  if (victims !== undefined) parts.push(victims ? "есть пострадавшие" : "пострадавших нет");
  return parts.length ? parts.join(", ") : error.onSite;
}

type CardFields = { address: unknown; flags: unknown; descriptionLog: unknown };

/** The card after the correction: the fields of the fix and the operator's line in the journal. */
export function correctedCard(card: CardFields, error: CardError, dispatcher: string, now: Date): { address: IncidentAddress; flags: IncidentFlags; descriptionLog: DescriptionEntry[] } {
  const address: Record<string, string> = { ...((card.address as Record<string, string> | null) ?? {}) };
  for (const [key, value] of Object.entries(error.fix?.address ?? {})) {
    if (value) address[key] = value;
    else delete address[key];
  }
  const flags: IncidentFlags = { ...((card.flags as IncidentFlags | null) ?? {}), ...(error.fix?.flags ?? {}) };
  const was = error.inCard ? `; в карточке было «${error.inCard}»` : "";
  const text = `${NOTE} по звонку диспетчера «${dispatcher}»: ${error.onSite}${was}.`;
  return { address, flags, descriptionLog: [...readLog(card.descriptionLog), { at: now.toISOString(), author: OPERATOR_112_AUTHOR, text }] };
}
