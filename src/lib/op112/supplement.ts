/**
 * «Дополнить» (Shift+F2) — supplements to a saved 112 card. The instruction: «После этого станут доступными для
 * внесения информации поля, в которых не была зарегистрирована информация до сохранения карточки, а также поле
 * «Описание со слов заявителя»» and «Возможно изменять признак наличия пострадавших после сохранения карточки».
 * A filled field stays as it was (the name and status of the caller cannot be changed after saving).
 */
import type { IncidentAddress, IncidentCaller } from "@/lib/incident/types";

export const SUPPLEMENT_CALLER: (keyof IncidentCaller)[] = ["fullName", "status", "provided", "onSite", "channel"];
export const SUPPLEMENT_ADDRESS: (keyof IncidentAddress)[] = [
  "country",
  "subject",
  "city",
  "object",
  "okrug",
  "district",
  "street",
  "house",
  "building",
  "structure",
  "flat",
  "entrance",
  "floor",
  "code",
  "descriptive",
];

const LABEL: Partial<Record<keyof IncidentCaller | keyof IncidentAddress, string>> = {
  fullName: "ФИО",
  status: "статус",
  provided: "предоставленный телефон",
  onSite: "телефон на место",
  channel: "канал связи",
  object: "объект",
  okrug: "округ",
  district: "район",
  street: "улица",
  house: "дом",
  building: "корпус",
  structure: "строение",
  flat: "квартира",
  entrance: "подъезд",
  floor: "этаж",
  code: "код",
  descriptive: "описательный адрес",
};

const blank = (v: unknown) => v === undefined || v === null || (typeof v === "string" && !v.trim());

/** A field the operator may still fill: it was empty when the card was saved. */
export function openForSupplement(value: unknown): boolean {
  return blank(value);
}

export type Supplement = {
  caller: IncidentCaller;
  address: IncidentAddress;
  victims: boolean;
  description: string;
  /** the line for the card's description journal («журнал описаний» the ДДС reads), empty when nothing changed */
  entry: string;
};

/** What the supplement changes: only fields that were empty, the description and the victims flag. */
export function applySupplement(
  stored: { caller: IncidentCaller; address: IncidentAddress; victims: boolean; description: string },
  sent: { caller: IncidentCaller; address: IncidentAddress; victims: boolean; description: string },
): Supplement {
  const caller: IncidentCaller = { ...stored.caller };
  const address: IncidentAddress = { ...stored.address };
  const filled: string[] = [];
  for (const k of SUPPLEMENT_CALLER) {
    const v = sent.caller[k];
    if (blank(stored.caller[k]) && !blank(v)) {
      (caller as Record<string, unknown>)[k] = typeof v === "string" ? v.trim() : v;
      filled.push(`${LABEL[k] ?? k}: ${String(v).trim()}`);
    }
  }
  for (const k of SUPPLEMENT_ADDRESS) {
    const v = sent.address[k];
    if (blank(stored.address[k]) && !blank(v)) {
      address[k] = v!.trim();
      // Country, subject and city come with a picked address; the journal names what matters to a crew.
      if (LABEL[k]) filled.push(`${LABEL[k]}: ${v!.trim()}`);
    }
  }
  // The description: what was added to the saved text goes to the journal; a rewritten text goes whole.
  const before = stored.description.trim();
  const after = sent.description.trim();
  const added = !after || after === before ? "" : before && after.startsWith(before) ? after.slice(before.length).trim() : after;
  const parts = [
    added,
    filled.length ? `Дополнено: ${filled.join(", ")}` : "",
    sent.victims !== stored.victims ? `Пострадавшие: ${sent.victims ? "есть" : "нет"}` : "",
  ].filter(Boolean);
  const entry = parts.map((x) => (/[.!?…]$/.test(x) ? x : `${x}.`)).join(" ");
  return { caller, address, victims: sent.victims, description: after || before, entry };
}
