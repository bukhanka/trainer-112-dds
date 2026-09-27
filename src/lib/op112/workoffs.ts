/**
 * «Журнал отработок» of a saved 112 card (Incident.workLog) and the check that every service working by phone
 * was told about the card.
 *
 * The instruction: «После сохранения карточки становится доступной кнопка «Добавить отработку». Эта функция
 * предназначена для регистрации звонков в службы, которые не оповещены автоматически». A row holds «Служба» (from
 * the directory only), «Куда звонили» (when the service is not in it), «Телефон», «Кто принял», «Суть сообщения»;
 * the tick saves it once at least one field is filled.
 */
import { z } from "zod";
import type { CriterionResult } from "@/lib/scoring/score";
import { low } from "./facts";
import type { CallLine } from "./types";

/** «дежурный Петров», «дежурная Васильева». Kept here, in a module the browser also loads. */
export function dutyTitle(surname: string): string {
  return `${/(ова|ева|ёва|ина|ая)$/i.test(surname.trim()) ? "дежурная" : "дежурный"} ${surname}`;
}

export type WorkOff = {
  id: string;
  at: string;
  operator: string;
  arm: string;
  serviceId?: number;
  service?: string;
  where?: string;
  phone?: string;
  acceptedBy?: string;
  summary?: string;
  /** the call made from this row, if any */
  callId?: string;
};

const field = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

/** A new row as the workstation sends it. */
export const workOffInput = z
  .object({
    serviceId: z.number().int().positive().optional(),
    where: field(200),
    phone: field(40),
    acceptedBy: field(120),
    summary: field(500),
    callId: z.string().max(40).optional(),
  })
  .refine((r) => Boolean(r.serviceId || r.where || r.phone || r.acceptedBy || r.summary), { message: "empty" });

export type WorkOffInput = z.infer<typeof workOffInput>;

/** Stored rows; anything malformed is skipped rather than breaking the card. */
export function readWorkLog(raw: unknown): WorkOff[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((r): r is WorkOff => Boolean(r) && typeof r === "object" && typeof (r as WorkOff).id === "string");
}

/** A call from the work-off row as the checks see it. */
export type PhoneCall = { id: string; serviceId: number; duty: string; at: string; messages: CallLine[] };

export type PhoneNotice = {
  serviceId: number;
  name: string;
  /** the duty's line that took the card */
  accepted?: { at: string; text: string; duty: string };
  entry?: WorkOff;
  problem?: "no_call" | "not_accepted" | "no_record" | "no_person" | "wrong_person";
};

/** «Кто принял» names the person who answered: the same surname stem, or the operator number said. */
export function sameDuty(written: string | undefined, duty: string): boolean {
  const w = low(written ?? "").trim();
  if (!w) return false;
  const stem = low(duty).slice(0, 4);
  return w.split(/[^а-яa-z0-9]+/).some((word) => word.length >= 4 && word.startsWith(stem));
}

/** For each phone-only plate: was the card passed on the phone and written into the work-offs? */
export function phoneNotices(plates: { serviceId: number; name: string }[], calls: PhoneCall[], log: WorkOff[]): PhoneNotice[] {
  return plates.map((p) => {
    const mine = calls.filter((c) => c.serviceId === p.serviceId);
    const acceptedCall = mine.find((c) => c.messages.some((m) => m.accepted));
    const line = acceptedCall?.messages.find((m) => m.accepted);
    const accepted = acceptedCall && line ? { at: line.at, text: line.text, duty: acceptedCall.duty } : undefined;
    const entries = log.filter((e) => e.serviceId === p.serviceId);
    const entry = (accepted && entries.find((e) => sameDuty(e.acceptedBy, accepted.duty))) ?? entries.find((e) => e.acceptedBy) ?? entries[0];
    let problem: PhoneNotice["problem"];
    if (!mine.length) problem = "no_call";
    else if (!accepted) problem = "not_accepted";
    else if (!entry) problem = "no_record";
    else if (!entry.acceptedBy) problem = "no_person";
    else if (!sameDuty(entry.acceptedBy, accepted.duty)) problem = "wrong_person";
    return { serviceId: p.serviceId, name: p.name, accepted, entry, problem };
  });
}

/** Plates that still block a clean «отработана»: no accepted call, or the call is not written down. */
export function unfinishedNotices(notices: PhoneNotice[]): { name: string; reason: "call" | "record" }[] {
  return notices
    .filter((n) => n.problem)
    .map((n) => ({ name: n.name, reason: n.problem === "no_call" || n.problem === "not_accepted" ? "call" : "record" }));
}

const hhmm = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
};
const quote = (s: string, max = 90) => `«${s.length > max ? `${s.slice(0, max - 1)}…` : s}»`;

function noticeText(n: PhoneNotice): string {
  const said = n.accepted ? `звонок ${hhmm(n.accepted.at)}, ${dutyTitle(n.accepted.duty)}: ${quote(n.accepted.text)}` : "";
  switch (n.problem) {
    case "no_call":
      return `${n.name}: не звонили`;
    case "not_accepted":
      return `${n.name}: звонили, но карточку не приняли — дежурному нужны номер карточки, адрес и что случилось`;
    case "no_record":
      return `${n.name}: ${said}; отработка не записана`;
    case "no_person":
      return `${n.name}: ${said}; в отработке не записано, кто принял`;
    case "wrong_person":
      return `${n.name}: ${said}; в «кто принял» записано ${quote(n.entry?.acceptedBy ?? "")}`;
    default:
      return `${n.name}: ${said}; в отработке: кто принял — ${n.entry?.acceptedBy}${n.entry?.summary ? `, суть — ${quote(n.entry.summary, 60)}` : ""}`;
  }
}

export const PHONE_CODE = "op112.phone.notified";
const PHONE_TITLE = "Все службы, работающие по телефону, оповещены";

/**
 * The review check. Before «отработана» (notices = null) it is «не применимо»: the calls are made after saving.
 * No phone-only plate on the card — no check.
 */
export function phoneCheck(plates: { serviceId: number; name: string }[], notices: PhoneNotice[] | null): CriterionResult | null {
  if (!plates.length) return null;
  if (!notices) {
    return {
      code: PHONE_CODE,
      group: "services",
      title: PHONE_TITLE,
      ok: null,
      source: "rule",
      evidence: `${plates.map((p) => p.name).join(", ")} — оповещаются только по телефону; проверяется после «отработана»`,
    };
  }
  const bad = notices.filter((n) => n.problem);
  return {
    code: PHONE_CODE,
    group: "services",
    title: PHONE_TITLE,
    ok: bad.length === 0,
    source: "rule",
    evidence: notices.map(noticeText).join("; "),
    expected: bad.length
      ? "После сохранения позвонить из отработки (трубка в строке): назвать номер карточки, адрес и что случилось, записать «кто принял» и «суть»"
      : undefined,
  };
}
