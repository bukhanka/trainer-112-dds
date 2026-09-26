/**
 * Shapes used by the 112 operator workstation: the questionnaire («опросная карта»), what the
 * operator has filled, the AI caller conversation and the reference answer of a scenario.
 */
import type { CallerStatus, FlagKey, IncidentAddress, IncidentCaller, IncidentFlags } from "@/lib/incident/types";

/** One entry of the «что случилось?» list. */
export type WhatHappened = {
  key: string; // stable id, e.g. "101", "dtp"
  name: string; // as in the customer's list
  chip: string; // chip and card header: «Происшествие 101», «П: Взрыв»
  synonyms?: string[];
  group: "code" | "type" | "info" | "service";
};

/** Visibility of a questionnaire row: rows appear as the operator answers the rows above. */
export type RowCondition =
  | { row: string; is: string[] } // row answered with one of the values
  | { row: string; answered: true } // row has any answer
  | { all: RowCondition[] };

export type QuestionRow = {
  id: string;
  label: string;
  kind: "single" | "multi" | "toggle" | "text";
  options?: string[]; // buttons; a toggle has exactly one
  /** Yes/No rows and toggles set a routing flag: «Да» / toggle on → true, «Нет» → false. */
  flag?: FlagKey;
  showIf?: RowCondition;
};

export type QuestionCard = { key: string; title: string; rows: QuestionRow[] };

/** Answers of one card: row id → chosen values (a text row keeps one string). */
export type CardAnswers = Record<string, string[]>;

/** Stored in Incident.tags: a flat list the ДДС card prints as «тег · тег · тег». */
export type StoredTag = { card: string; rowId: string; row: string; value: string };

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
  | "other";

export type FactCard = {
  key: string;
  topic: FactTopic;
  text: string; // how the caller says it
  label: string; // short name in the review, e.g. «газификация»
  expect?: FactExpectation;
};

/** A question the operator must ask; keywords are regex sources matched against operator lines. */
export type RequiredQuestion = { text: string; topic?: FactTopic; keywords?: string[] };

/** Reference answer of a scenario for the 112 place (Scenario.truth). */
export type ScenarioTruth = {
  cards: string[]; // expected «что случилось» keys
  typeCodes: number[];
  tags: { card?: string; row: string; value: string }[];
  flags: IncidentFlags;
  address: IncidentAddress; // the real (clarified) place
  services: (number | string)[]; // ids or short names; empty → computed by the routing engine
  requiredQuestions: RequiredQuestion[];
  callerStatus?: CallerStatus;
  descriptionKeywords: string[]; // the gist that must be in the first 100 characters
};
