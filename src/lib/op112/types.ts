/**
 * Shapes used by the 112 operator workstation: the questionnaire («опросная карта»), what the
 * operator has filled, the AI caller conversation and the reference answer of a scenario.
 */
import type { CallerStatus, FlagKey, IncidentAddress, IncidentCaller, IncidentFlags } from "@/lib/incident/types";

/** Answers of one panel: row id → chosen values (a text row keeps one string). */
export type CardAnswers = Record<string, string[]>;

/**
 * Stored in Incident.tags: a flat list the ДДС card prints as «тег . тег . тег» (row + value as in
 * TagChoice). `card` and `rowId` let the workstation restore the panels; a free-text row keeps its
 * raw text in `text` and «Этажность здания: 14» in `value`.
 */
export type StoredTag = { card: string; rowId: string; row: string; value: string; text?: string };

/** The card as the operator fills it (client state, autosave and save payload). */
export type Op112CardDraft = {
  caller: IncidentCaller;
  address: IncidentAddress;
  flags: IncidentFlags;
  cards: string[]; // chosen «что случилось» keys in order
  answers: Record<string, CardAnswers>; // card key → answers
  description: string;
  manualServiceIds: number[];
};

export type RoutedService = { serviceId: number; isMain: boolean; auto: boolean };

/** A line of the caller conversation (Call.messages). */
export type CallLine = {
  role: "counterpart" | "trainee";
  text: string;
  at: string;
  revealed?: string[]; // fact keys the caller disclosed in this line
};

/** A fact the caller knows and how the card should reflect it once said. */
export type FactExpectation =
  | { kind: "flag"; flag: FlagKey; value: boolean }
  | { kind: "tag"; row: string; value: string } // row label, value (text rows: substring)
  | { kind: "address" }
  | { kind: "name" }
  | { kind: "status"; value: CallerStatus }
  | { kind: "phone" }
  | { kind: "description"; keywords: string[] };

export type FactTopic =
  | "what"
  | "address"
  | "addressExact"
  | "name"
  | "phone"
  | "status"
  | "victims"
  | "gas"
  | "floors"
  | "access"
  | "threat"
  | "fire"
  | "consciousness"
  | "age"
  | "breathing"
  | "weapon"
  | "people"
  | "object"
  | "other";

export type FactCard = {
  key: string;
  topic: FactTopic;
  text: string; // how the caller says it
  label: string; // short name in the review, e.g. «газификация»
  expect?: FactExpectation;
  /** facts split from one ticket line share it: saying the line discloses all of them */
  group?: string;
};

/** A question the operator must ask; keywords are regex sources matched against operator lines. */
export type RequiredQuestion = { text: string; topic?: FactTopic; keywords?: string[] };

/** Reference answer of a scenario for the 112 place (Scenario.truth), as the checks read it. */
export type ScenarioTruth = {
  kind?: string; // expected «что случилось», e.g. «101», «ДТП»
  typeCodes: number[]; // reference classifier leaves
  acceptableTypeCodes: number[]; // other leaves that count as right
  finalType?: string;
  flags: IncidentFlags;
  address: IncidentAddress;
  services: number[]; // expected plates; empty → computed by the routing engine
  requiredQuestions: RequiredQuestion[];
  callerStatus?: CallerStatus;
  descriptionKeywords: string[]; // regex sources; each must be in the first 100 characters
  traps: string[];
  emptyCall?: "noContact" | "dropped"; // the right answer is an empty card
};
