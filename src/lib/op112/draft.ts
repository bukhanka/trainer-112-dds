/** Validation of what the workstation sends and conversion of a stored Incident back to a draft. */
import { z } from "zod";
import type { Incident } from "@prisma/client";
import { CALLER_STATUSES, type IncidentAddress, type IncidentCaller, type IncidentFlags } from "@/lib/incident/types";
import { deriveFlags, tagsToAnswers, TOP_FLAGS } from "./card";
import type { Op112CardDraft } from "./types";

const text = (max: number) => z.string().trim().max(max).optional();

export const callerSchema = z.object({
  fullName: text(120),
  status: z.enum(CALLER_STATUSES).optional(),
  aon: text(40),
  provided: text(40),
  onSite: text(40),
  channel: text(60),
  foreignLanguage: z.boolean().optional(),
});

export const addressSchema = z.object({
  country: text(60),
  subject: text(80),
  city: text(80),
  object: text(200),
  okrug: text(40),
  district: text(80),
  street: text(200),
  house: text(20),
  building: text(20),
  structure: text(20),
  flat: text(20),
  entrance: text(20),
  floor: text(20),
  code: text(40),
  descriptive: text(1000),
});

export const draftSchema = z.object({
  caller: callerSchema.default({}),
  address: addressSchema.default({}),
  flags: z
    .object({ victims: z.boolean().optional(), refusedAmbulance: z.boolean().optional(), noAccess: z.boolean().optional() })
    .default({}),
  cards: z.array(z.string().max(40)).max(8).default([]),
  answers: z.record(z.string(), z.record(z.string(), z.array(z.string().max(300)).max(30))).default({}),
  description: z.string().max(1999).default(""),
  manualServiceIds: z.array(z.number().int().positive()).max(250).default([]),
});

export type DraftInput = z.infer<typeof draftSchema>;

/** Draft shown by the workstation for a stored card. */
export function draftFromIncident(incident: Pick<Incident, "caller" | "address" | "flags" | "tags" | "description">): Op112CardDraft {
  const { cards, answers } = tagsToAnswers(incident.tags);
  const stored = (incident.flags ?? {}) as IncidentFlags;
  // A top button is on when its flag is stored but no questionnaire row explains it.
  const fromRows = deriveFlags({}, cards, answers);
  const top: IncidentFlags = {};
  for (const k of TOP_FLAGS) if (stored[k] && !fromRows[k]) top[k] = true;
  return {
    caller: (incident.caller ?? {}) as IncidentCaller,
    address: (incident.address ?? {}) as IncidentAddress,
    flags: top,
    cards,
    answers,
    description: incident.description ?? "",
    manualServiceIds: [],
  };
}
