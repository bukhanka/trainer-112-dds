/**
 * What a ДДС place sees and how its lesson is set up — shared by the flow, the phone and the views.
 */
import type { Prisma, Seat } from "@prisma/client";
import { lessonSettingsSchema, type LessonSettings } from "@/lib/lessons/settings";

/** Author of generated descriptions, as on the customer's training stand. */
export const TRAINING_OPERATOR = "0 УМЦ О.п.";
export const SYSTEM_ACTOR = "оп. 0";

/** Statuses after which the card no longer waits for this place. */
export const DONE_STATUSES = ["FINISHED", "REFUSED", "REJECTED"] as const;

export function settingsOf(raw: unknown): LessonSettings {
  const parsed = lessonSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : lessonSettingsSchema.parse({});
}

export type SeatRef = Pick<Seat, "id" | "lessonId" | "serviceId">;

/**
 * Cards shown at a ДДС place: cards generated for it, plus cards saved at the 112 places of the same
 * lesson that carry its service. The same rule serves every ДДС (#684: one algorithm for all).
 * Generated cards made by other tools (the demo lessons) may name the place only in the «Добавлена»
 * event of its plate instead of Incident.ddsSeatId — those count as the place's own too.
 */
export function seatFeedWhere(seat: SeatRef): Prisma.IncidentWhereInput {
  const own: Prisma.IncidentWhereInput = { ddsSeatId: seat.id };
  if (!seat.serviceId) return own;
  return {
    OR: [
      own,
      {
        lessonId: seat.lessonId,
        ddsSeatId: null,
        source: { not: "generated" },
        NOT: { status: "draft" },
        services: { some: { serviceId: seat.serviceId } },
      },
      {
        lessonId: seat.lessonId,
        ddsSeatId: null,
        source: "generated",
        services: { some: { serviceId: seat.serviceId, events: { some: { status: "ADDED", seatId: seat.id } } } },
      },
    ],
  };
}
