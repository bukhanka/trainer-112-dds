/** Shared shapes of an incident card. Stored in Incident.caller / address / flags / tags (JSON). */

/** Flags the 112 operator sets; they drive conditional routing of services. */
export type IncidentFlags = {
  victims?: boolean; // Пострадавшие
  victimsAbsent?: boolean; // пострадавшие не на месте
  refusedAmbulance?: boolean; // Нет на месте / Отказ от скорой
  noAccess?: boolean; // Нет доступа / Заблокированные
  threat?: boolean; // Угроза людям
  med?: boolean; // Медицинская помощь
  evac?: boolean; // Требуется эвакуация
  gas?: boolean; // Проведена газификация
  offense?: boolean; // Есть правонарушение
  traffic?: boolean; // Перекрытие движения
  tunnel?: boolean;
  crossing?: boolean; // пешеходный переход
  crowd?: boolean; // > 5 человек / ОД
  construction?: boolean; // стройка
  objectList?: boolean; // объект из перечня (культура)
  comm?: boolean; // объект связи
};

export type FlagKey = keyof IncidentFlags;

export type IncidentAddress = {
  country?: string;
  subject?: string;
  city?: string;
  object?: string;
  okrug?: string;
  district?: string;
  street?: string;
  house?: string;
  building?: string;
  structure?: string;
  flat?: string;
  entrance?: string;
  floor?: string;
  code?: string;
  descriptive?: string; // описательный адрес
};

export const CALLER_STATUSES = ["очевидец", "пострадавший", "родственник", "знакомый", "ребёнок", "участник"] as const;
export type CallerStatus = (typeof CALLER_STATUSES)[number];

export type IncidentCaller = {
  fullName?: string;
  status?: CallerStatus;
  aon?: string; // определившийся номер
  provided?: string; // предоставленный
  onSite?: string; // телефон на место
  channel?: string;
  foreignLanguage?: boolean;
};

export type TagChoice = { row: string; value: string };

export type DescriptionEntry = { at: string; author: string; text: string };

/** Persona of the AI caller built from a ticket (Scenario.caller). */
export type CallerPersona = {
  fullName: string;
  role: string; // очевидец, мама, работник АЗС…
  phone?: string;
  visibleAddress: string; // what the caller says first
  hiddenAddress?: string; // revealed only when the operator asks to clarify
  situation: string; // what happened, in the caller's words
  facts: string[]; // answered only when asked
  temper?: "calm" | "panic" | "elderly" | "child" | "drunk" | "angry";
  voice?: "male" | "female";
  /**
   * What the line does, for the «нет контакта» / «срыв звонка» tasks: «silent» — the operator hears only noise;
   * «drops» — the call breaks off after `dropAfter` operator lines or when the address is asked a second time.
   */
  line?: "silent" | "drops";
  /** Operator lines after which the line goes dead (silent: the caller hangs up; drops: the call breaks). */
  dropAfter?: number;
  /** The first words, said as written instead of a generated opening (a call that breaks mid-sentence). */
  opening?: string;
  /** Last words cut off by the break («Алло, вы меня слы…»). */
  dropLine?: string;
};
