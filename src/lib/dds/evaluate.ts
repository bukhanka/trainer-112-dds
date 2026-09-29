/**
 * Review of one ДДС plate against the dispatcher memo's error catalogue (report D4) — rules only, no model.
 * Each check becomes a CriterionResult of a weight group; «не применимо» is ok: null and does not count.
 *
 *   timeliness   — the card opened within ackSec (30 s) and its first record — status and text — within workSec
 *                  (3 min), both from «Добавлена» (customer's answer of 27.09: statuses have no other time norms);
 *                  crew calls answered
 *   comments     — reason and «кому передано» for Не принята / Отказ; meaningful final comment
 *   statusOrder  — progress statuses not skipped; statuses by the facts of reports; status matches its meaning;
 *                  the card closed with the right status
 *   services     — the decision matches the scenario's reference for this service
 *   completeness — callback to the applicant without the card number (#740); an error in the card reported to 112
 *   literacy     — comments are clear to the next dispatcher: rules here (clarity.ts); with a model
 *                  configured the review adds the model's own check (clarity-ai.ts)
 */
import type { ServiceStatus } from "@prisma/client";
import { countLabel } from "@/lib/format";
import { errorTitle } from "@/lib/scoring/errors";
import { computeScore, type CriterionResult, type Weights } from "@/lib/scoring/score";
import { describeTemplates, matchTemplate, parseTemplates, templateProblem } from "@/lib/scoring/template";
import { clarityIssues, judgedComments, statesResult, type ClarityIssue } from "./clarity";
import { CREW_PACE_SEC, crewPlanFor, crewSchedule, stageAt, type Dispatch } from "./crew";
import { fmtDuration, fmtDateTime } from "./format";
import { atSite, mentionsCardNumber } from "./personas";
import { saysCardErrorRight, type DdsReferenceEntry } from "./scenario";
import { awaitsAnswer, isRecord, NO_CREW_COMMENT, PROGRESS, STATUS_LABEL, type ServiceRules } from "./status";

export type PlateEvent = { status: ServiceStatus; comment: string | null; crewNumber: string | null; at: Date; late: boolean };

export type PlateFacts = {
  addedAt: Date;
  status: ServiceStatus;
  /** Own plate events, oldest first (technical ones included). */
  events: PlateEvent[];
  rules: ServiceRules;
  ackSec: number;
  workSec: number;
  reference: DdsReferenceEntry | null;
  dispatch: Dispatch | null;
  /** Crew reports the dispatcher heard (answered incoming calls and their own calls to the crew). */
  reports: { status: ServiceStatus | "DISPATCHED"; at: Date }[];
  /**
   * Incoming crew calls: rang / lost, and when the dispatcher called the crew back after a lost one — the senior then
   * reports what was missed (calls.ts), so each such call back makes up one lost report.
   */
  crewCalls: { rang: number; missed: number; madeUp?: Date[] };
  callbacks: { at: Date; namedCardNumber: boolean }[];
  /** Number of the card: a call to 112 about an error names it. */
  cardNumber?: number;
  /** Calls to 112 about this card (or naming it): when, and the dispatcher's lines. */
  calls112?: { at: Date; lines: string[] }[];
  /** Moment of the review: closing of the plate or the end of the lesson. */
  now: Date;
  /** Abbreviations printed on the service plates (they count as official in the clarity check). */
  knownAbbreviations?: string[];
  /** The lesson's phrase templates for the final comment, one per line (empty — no such check). */
  commentTemplate?: string;
};

const ISSUE_LABEL: Record<ClarityIssue["kind"], string> = {
  short: "слишком коротко, не понять без звонка",
  noResult: "не сказано, чем закончилось",
  abbreviation: "сокращение, которое знает не каждый диспетчер",
  layout: "набрано в английской раскладке",
};

const RANK: Record<ServiceStatus, number> = {
  ADDED: 0,
  RECEIVED: 1,
  REJECTED: 2,
  ACCEPTED: 3,
  STARTED: 4,
  ARRIVED: 5,
  WORKING: 6,
  FINISHED: 7,
  REFUSED: 7,
};

const TRANSFER = /(переда[нл]|передаю|сообщ(ено|ил|или|ила)|проинформ|направлен[ао]? в|дубл|кп\s*№?\s*\d|по карточке|реагировани[ея] по|ук\s|ооо|гбу|ддс|служб[аеуы]\s*10\d|«[^»]+»|"[^"]+")/i;
// «не наш…» only as a whole word: «не нашли утечку» is not a refusal.
const REFUSAL_WORDS = /(не обслужива|не наш(?:а|е|и|его|ей|у|ему|им)?(?![а-яё])|не в компетенц|не относится|нет договора|не будем|работы не провод|не проводил)/i;
const GENERIC_FINAL = /^(работы завершены|завершено|выполнено|готово|ок|сделано|всё|все|закрыто)[.!]?$/i;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const quote = (s: string | null) => (s ? `«${s.length > 120 ? `${s.slice(0, 117)}…` : s}»` : "без комментария");
const secBetween = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 1000;

type Decision = "accept" | "reject" | null;

/** The decision the dispatcher stands by: Принята (possibly after Не принята) or Не принята; 103 closing without a crew counts as a refusal. */
export function decisionOf(events: PlateEvent[], rules: ServiceRules): { decision: Decision; event: PlateEvent | null } {
  const answers = events.filter((e) => e.status === "ACCEPTED" || e.status === "REJECTED");
  const first = events.find((e) => !awaitsAnswer(e.status)) ?? null;
  if (rules.noReject && first?.status === "FINISHED") return { decision: "reject", event: first };
  const last = answers[answers.length - 1] ?? null;
  if (!last) return { decision: null, event: null };
  return { decision: last.status === "ACCEPTED" ? "accept" : "reject", event: last };
}

const STOP_WORD = /^(что|кто|как|где|когда|какой|какая|какие|чем|если|или|для|при|после|через|итог|итоги|время|причина|кому|есть|было|были|этот|также|сделано)$/;

/** «Кто направлен (обслуживающая организация)», «кто выезжал от района»: the reference asks who went there… */
const WHO_WENT = /^кто\s+(выезжал|выехал|направлен|проверил|прибыл|работал)/;
/** …and a named organisation, crew or person answers it: «сотрудник ГБУ «Жилищник»», «представитель управы». */
const ACTOR =
  /(гбу|жилищник|управ[аыуе](?![а-яё])|префектур|ук(?![а-яё])|управляющ|ооо|«[^»]+»|"[^"]+"|сотрудник|представител|мастер|инженер|техник|бригад|наряд|отделени|псч|электрик|сантехник|участков|полици)/i;

/** A must-have of the reference («что сделано: перекрыт кран») is covered when a stem of its words is in the comment. */
export function phraseCovered(comment: string, phrase: string): boolean {
  const text = comment.toLowerCase().replace(/ё/g, "е");
  const p = phrase.toLowerCase().replace(/ё/g, "е");
  if (/время/.test(p) && /\b\d{1,2}[:.]\d{2}\b/.test(text)) return true;
  if (/(кому|передан)/.test(p) && TRANSFER.test(comment)) return true;
  if (WHO_WENT.test(p) && ACTOR.test(text)) return true;
  const words = (p.match(/[а-я]{4,}/g) ?? []).filter((w) => !STOP_WORD.test(w));
  if (!words.length) return text.trim().length > 0;
  return words.some((w) => text.includes(w.slice(0, Math.max(4, Math.min(6, w.length - 2)))));
}

type CrewCall = { at: Date; crew?: string | null };

/**
 * When lost crew reports were made up: for each lost incoming call, the first later call the dispatcher made to the
 * same crew (a crew number unknown on either side matches any). The senior, picking up, reports what was missed.
 */
export function madeUpByCallBack(lost: CrewCall[], back: CrewCall[]): Date[] {
  const sorted = [...back].sort((a, b) => a.at.getTime() - b.at.getTime());
  return lost.flatMap((l) => {
    const call = sorted.find((b) => b.at > l.at && (!l.crew || !b.crew || b.crew === l.crew));
    return call ? [call.at] : [];
  });
}

export function evaluateDdsPlate(f: PlateFacts): CriterionResult[] {
  const out: CriterionResult[] = [];
  const own = f.events.filter((e) => !awaitsAnswer(e.status));
  const first = own[0] ?? null;
  const { decision, event: decisionEvent } = decisionOf(f.events, f.rules);
  const closing = own.find((e) => e.status === "FINISHED" || e.status === "REFUSED") ?? null;
  const noCrewClose = f.rules.noReject && first?.status === "FINISHED";
  const ref = f.reference;

  // ── timeliness: two norms, by the customer's answer of 27.09 ──
  // 30 s from «Добавлена» to opening the card; 3 min from «Добавлена» to the first record — a status with a
  // text. Statuses have no other time norms: the works may take hours.
  const hms = (d: Date) => fmtDateTime(d).slice(11);
  const opened = f.events.find((e) => e.status !== "ADDED") ?? null;
  const record = own.find((e) => isRecord(e)) ?? null;
  const waited = secBetween(f.addedAt, f.now);
  const trail = [`появилась ${hms(f.addedAt)}`, opened ? `открыта ${hms(opened.at)}` : null, record ? `первая запись ${hms(record.at)}` : null]
    .filter(Boolean)
    .join(", ");
  if (opened) {
    const delay = secBetween(f.addedAt, opened.at);
    out.push({
      code: "dds.open_in_time",
      group: "timeliness",
      title: `Карточка открыта за ${f.ackSec} с`,
      ok: delay <= f.ackSec,
      evidence: `Карточка ${trail}: открыта через ${fmtDuration(delay)} (норматив ${fmtDuration(f.ackSec)})`,
      expected: `Открыть карточку в течение ${f.ackSec} с после того, как она появилась в ленте («Добавлена»), даже если она ждёт в очереди`,
      source: "rule",
    });
  } else {
    // A card that came in just before the end still had time left: nothing to judge yet.
    const expired = waited > f.ackSec;
    out.push({
      code: "dds.open_in_time",
      group: "timeliness",
      title: `Карточка открыта за ${f.ackSec} с`,
      ok: expired ? false : null,
      critical: expired,
      evidence: expired
        ? `Карточку не открыли: появилась ${hms(f.addedAt)}, прошло ${fmtDuration(waited)} — «Не оповещено»`
        : `Карточка пришла за ${fmtDuration(waited)} до конца — норматив ещё не истёк`,
      expected: `Открыть карточку в течение ${f.ackSec} с после «Добавлена»`,
      source: "rule",
    });
  }

  const bare = own.find((e) => !e.comment?.trim()) ?? null;
  if (record) {
    const delay = secBetween(f.addedAt, record.at);
    out.push({
      code: "dds.first_record_in_time",
      group: "timeliness",
      title: `Первая запись — статус и текст — за ${fmtDuration(f.workSec)}`,
      ok: delay <= f.workSec,
      evidence: `Карточка ${trail}: «${STATUS_LABEL[record.status]}: ${record.comment!.length > 80 ? `${record.comment!.slice(0, 77)}…` : record.comment}» через ${fmtDuration(delay)} (норматив ${fmtDuration(f.workSec)})`,
      expected: `Первая запись — статус и текст — в течение ${fmtDuration(f.workSec)} после «Добавлена»; статус без текста запись не закрывает`,
      source: "rule",
    });
  } else {
    const expired = waited > f.workSec;
    out.push({
      code: "dds.first_record_in_time",
      group: "timeliness",
      title: `Первая запись — статус и текст — за ${fmtDuration(f.workSec)}`,
      ok: expired ? false : null,
      critical: expired && !bare,
      evidence: expired
        ? bare
          ? `Карточка ${trail}: «${STATUS_LABEL[bare.status]}» поставлен без текста — это не запись; записи с текстом нет`
          : `Карточка ${trail}: записи нет — прошло ${fmtDuration(waited)}`
        : `Карточка пришла за ${fmtDuration(waited)} до конца — норматив ещё не истёк`,
      expected: "Поставить статус («Принята» или «Не принята») с текстом: что делаете или почему не берёте и кому передано",
      source: "rule",
    });
  }

  if (f.crewCalls.rang > 0) {
    const { rang, missed } = f.crewCalls;
    // A lost report the dispatcher made up by calling the crew back is done: the memo's «пропустили — перезвонить».
    const madeUp = (f.crewCalls.madeUp ?? []).slice(0, missed);
    const open = missed - madeUp.length;
    const backAt = [...new Set(madeUp.map(hms))].join(", ");
    out.push({
      code: "dds.crew_calls_answered",
      group: "timeliness",
      title: "Звонки наряда приняты",
      ok: open === 0,
      evidence: !missed
        ? `Приняты все доклады: ${rang}`
        : !open
          ? `Пропущено докладов: ${missed} из ${rang} — исправлено перезвоном: старшему наряда перезвонили в ${backAt}, он доложил пропущенное`
          : madeUp.length
            ? `Пропущено докладов: ${missed} из ${rang}; перезвоном в ${backAt} исправлено ${madeUp.length}, после остальных перезвона не было`
            : `Пропущено докладов: ${missed} из ${rang}, перезвона старшему после них не было`,
      expected: "Отвечать на звонки старшего наряда; пропустили — перезвонить самим",
      source: "rule",
    });
  }

  // No «status within N seconds of the report»: statuses have no time norms (customer's answer of 27.09) — a status
  // missing altogether is «Статусы хода работ проставлены», a status ahead of the report — «по факту».

  // ── comments ──
  const refusals = own.filter((e) => e.status === "REJECTED" || e.status === "REFUSED");
  if (refusals.length) {
    const short = refusals.filter((e) => (e.comment ?? "").split(/\s+/).filter(Boolean).length < 3);
    out.push({
      code: "dds.refusal_reason",
      group: "comments",
      title: "В «Не принята» / «Отказ» указана причина",
      ok: short.length === 0,
      evidence: refusals.map((e) => `${STATUS_LABEL[e.status]}: ${quote(e.comment)}`).join("; "),
      expected: "Причина словами: чья зона ответственности, почему службы нет",
      source: "rule",
    });
    const extra = ref?.transferTo ?? [];
    const named = refusals.filter((e) => {
      const c = e.comment ?? "";
      return TRANSFER.test(c) || extra.some((w) => c.toLowerCase().includes(w.toLowerCase()));
    });
    out.push({
      code: "dds.transfer_named",
      group: "comments",
      title: "Указано, кому передана информация",
      ok: named.length === refusals.length,
      evidence: refusals.map((e) => quote(e.comment)).join("; "),
      expected: `Организация и факт передачи («передано в …», «дубль», «КП № …»)${extra.length ? `; по эталону: ${extra.join(", ")}` : ""}`,
      source: "rule",
    });
  }

  if (closing) {
    const text = (closing.comment ?? "").trim();
    const noCrewOk = !noCrewClose || /без\s+бригады/i.test(text);
    // «Всё сделали, он уехал» is long enough but tells nothing of the works: the results must be named (clarity.ts).
    const vague = closing.status === "FINISHED" && !noCrewClose && !GENERIC_FINAL.test(text) && !statesResult(text);
    const meaningful = text.length >= (noCrewClose ? NO_CREW_COMMENT.length - 5 : 20) && !GENERIC_FINAL.test(text) && !vague;
    out.push({
      code: "dds.final_comment",
      group: "comments",
      title: "Итоговый комментарий содержательный",
      ok: meaningful && noCrewOk,
      evidence: `${STATUS_LABEL[closing.status]}: ${quote(closing.comment)}${vague ? " — не сказано, что сделано и чем закончилось" : ""}`,
      expected: noCrewClose
        ? `«${NO_CREW_COMMENT}» и причина`
        : "Итоги реагирования: что сделано, что устранено, кому передано — статус закрывает карточку",
      source: "rule",
    });
  }

  // What the reference wants to read in the comment that ends the service's work on the card.
  const endComment = closing ?? (decision === "reject" ? decisionEvent : null);
  if (endComment && ref?.finalMust.length && ref.decision !== "open" && !noCrewClose) {
    const text = endComment.comment ?? "";
    const miss = ref.finalMust.filter((p) => !phraseCovered(text, p));
    out.push({
      code: "dds.comment_content",
      group: "comments",
      title: "В комментарии есть то, что требует эталон",
      // The verdict follows what the evidence says: anything missing is a mistake.
      ok: miss.length === 0,
      evidence: `${STATUS_LABEL[endComment.status]}: ${quote(endComment.comment)}${miss.length ? ` — не хватает: ${miss.join("; ")}` : ""}`,
      expected: ref.finalMust.join("; "),
      source: "rule",
    });
  }

  // The lesson's own phrase for the final comment («Наряд № {номер} направлен…»), if the teacher set one. It is the
  // syntax of the report on work done: a refusal («Не принята», «Отказ») has no crew and no results to fit it.
  const templates = parseTemplates(f.commentTemplate).filter((t) => !templateProblem(t)); // a broken line is shown in the form, not held against the student
  if (closing?.status === "FINISHED" && templates.length && !noCrewClose) {
    const hit = matchTemplate(closing.comment ?? "", templates);
    const hints = describeTemplates(templates);
    out.push({
      code: "dds.comment_template",
      group: "comments",
      title: "Итоговый комментарий по шаблону занятия",
      ok: hit.ok,
      evidence: `${STATUS_LABEL[closing.status]}: ${quote(closing.comment)} — ${hit.ok ? `совпадает с «${hit.template}»` : "по шаблону не написан"}`,
      expected: `${templates.map((t) => `«${t}»`).join(" или ")}${hints ? ` (${hints})` : ""}`,
      source: "rule",
    });
  }

  // ── statusOrder ──
  const { chain } = crewPlanFor(ref);
  const expectedProgress = chain.filter((s) => PROGRESS.includes(s));
  // An «open» reference expects no crew: progress statuses are asked for only if the dispatcher sent one.
  if (decision === "accept" && !noCrewClose && expectedProgress.length && (ref?.decision !== "open" || f.dispatch) && (closing || f.dispatch)) {
    const schedule = crewSchedule(chain, CREW_PACE_SEC);
    const reached = f.dispatch ? stageAt(schedule, secBetween(f.dispatch.at, closing?.at ?? f.now)) : null;
    const due = f.dispatch ? expectedProgress.filter((s) => reached && RANK[reached] >= RANK[s]) : expectedProgress;
    const set = new Set(own.map((e) => e.status));
    const missing = due.filter((s) => !set.has(s));
    if (due.length) {
      out.push({
        code: "dds.progress_statuses",
        group: "statusOrder",
        title: "Статусы хода работ проставлены",
        ok: missing.length === 0,
        evidence: missing.length
          ? `Пропущено: ${missing.map((s) => `«${STATUS_LABEL[s]}»`).join(", ")}`
          : `Поставлены: ${due.map((s) => `«${STATUS_LABEL[s]}»`).join(", ")}`,
        expected: "Начало реагирования, Прибытие, Проведение работ — по мере докладов, с комментариями",
        source: "rule",
      });
    }
  }

  if (f.dispatch && decision === "accept") {
    const schedule = crewSchedule(chain, CREW_PACE_SEC);
    const early = own.filter((e) => {
      if (!["STARTED", "ARRIVED", "WORKING", "FINISHED"].includes(e.status) || e.at <= f.dispatch!.at) return false; // the dispatch event itself is fine
      const step = schedule.find((s) => s.status === e.status);
      if (!step) return false;
      const heard = f.reports.some((r) => r.status === e.status && r.at <= new Date(e.at.getTime() + 5_000));
      return !heard && secBetween(f.dispatch!.at, e.at) + 10 < step.afterSec;
    });
    if (own.some((e) => ["STARTED", "ARRIVED", "WORKING", "FINISHED"].includes(e.status))) {
      out.push({
        code: "dds.status_by_facts",
        group: "statusOrder",
        title: "Статусы ставятся по факту, после доклада наряда",
        ok: early.length === 0,
        evidence: early.length
          ? early.map((e) => `«${STATUS_LABEL[e.status]}» в ${fmtDateTime(e.at).slice(11)} — наряд об этом ещё не докладывал`).join("; ")
          : "Статусы хода работ совпадают с докладами наряда",
        expected: "Не опережать события: статус — после доклада о выезде, прибытии, начале и окончании работ",
        source: "rule",
      });
    }
  }

  const accepted = own.filter((e) => e.status === "ACCEPTED" && e.comment);
  const finished = own.filter((e) => e.status === "FINISHED" && e.comment && !noCrewClose);
  if (accepted.length || finished.length) {
    const wrongAccept = accepted.filter((e) => REFUSAL_WORDS.test(e.comment!));
    const wrongFinish = finished.filter((e) => REFUSAL_WORDS.test(e.comment!));
    out.push({
      code: "dds.status_meaning",
      group: "statusOrder",
      title: "Статус соответствует смыслу комментария",
      ok: wrongAccept.length + wrongFinish.length === 0,
      evidence: [
        ...wrongAccept.map((e) => `«Принята: ${e.comment}» — по смыслу это «Не принята»`),
        ...wrongFinish.map((e) => `«Работы завершены: ${e.comment}» — по смыслу это «Отказ от выполнения работ»`),
      ].join("; ") || "Противоречий нет",
      expected: "Реагирования не будет — «Не принята»; работы не проводились — «Отказ от выполнения работ»",
      source: "rule",
    });
  }

  if (closing && ref && ref.decision === "accept" && !noCrewClose) {
    const want = chain.find((s) => s === "FINISHED" || s === "REFUSED") ?? "FINISHED";
    out.push({
      code: "dds.closing_status",
      group: "statusOrder",
      title: "Карточка закрыта правильным статусом",
      ok: closing.status === want,
      evidence: `Закрыта: «${STATUS_LABEL[closing.status]}», по эталону: «${STATUS_LABEL[want]}»`,
      expected: want === "REFUSED" ? `«Отказ от выполнения работ» с причиной и кому передано${ref.why ? ` (${ref.why})` : ""}` : "«Работы завершены» с итогами",
      source: "rule",
    });
  }

  // ── services: the decision itself ──
  if (ref?.decision === "open" && decision) {
    out.push({
      code: "dds.decision",
      group: "services",
      title: "Решение службы совпадает с эталоном",
      ok: null,
      evidence: `Решение: «${decision === "accept" ? "Принята" : STATUS_LABEL[decisionEvent?.status ?? "REJECTED"]}»; эталон решения для этой службы не задаёт`,
      expected: ref.why ?? "«Принята» — если служба будет что-то делать, иначе «Не принята» с причиной (памятка ДДС)",
      source: "rule",
    });
  } else if (ref && decision) {
    const ok = decision === ref.decision;
    out.push({
      code: "dds.decision",
      group: "services",
      title: "Решение службы совпадает с эталоном",
      ok,
      critical: !ok && ref.decision === "accept",
      evidence: `Решение: «${decision === "accept" ? "Принята" : STATUS_LABEL[decisionEvent?.status ?? "REJECTED"]}»${decisionEvent?.comment ? ` (${quote(decisionEvent.comment)})` : ""}; эталон: «${ref.decision === "accept" ? "Принята" : "Не принята"}»`,
      expected: ref.why ?? (ref.decision === "accept" ? "Профильное происшествие: реагировать" : "Не зона ответственности: «Не принята» с указанием, кому передано"),
      source: "rule",
    });
  }

  // ── completeness: callback to the applicant ──
  if (f.callbacks.length) {
    const named = f.callbacks.filter((c) => c.namedCardNumber);
    out.push({
      code: "dds.callback_rules",
      group: "completeness",
      title: "Перезвон заявителю без номера карточки",
      ok: named.length === 0,
      evidence: named.length ? "Заявителю назван номер карточки" : `Перезвонов: ${f.callbacks.length}, номер карточки не назван`,
      expected: "«Вы звонили в 112 по поводу …» — номер карточки заявителю не называют",
      source: "rule",
    });
  }

  // ── an error in the card: the crew finds it on site, the dispatcher phones 112 (customer's answer of 27.09) ──
  // Judged in every scenario with such an error, by the fact of the call: whatever the dispatcher learnt it from.
  const error = ref?.cardError;
  if (error) {
    // The crew tells the error in its first report from the site; a crew that got there rang to tell it even when
    // the dispatcher did not pick up — the arrival by its schedule, up to the closing of the plate.
    const told = f.reports.filter((r) => atSite(r.status)).sort((a, b) => a.at.getTime() - b.at.getTime())[0] ?? null;
    const siteStep = f.dispatch ? crewSchedule(chain, CREW_PACE_SEC).find((s) => atSite(s.status)) : undefined;
    const reachedAt = f.dispatch && siteStep ? new Date(f.dispatch.at.getTime() + siteStep.afterSec * 1000) : null;
    const arrived = told?.at ?? (reachedAt && reachedAt <= (closing?.at ?? f.now) ? reachedAt : null);
    const calls = (f.calls112 ?? []).map((c) => {
      const text = c.lines.join(" ");
      return { ...c, text, number: f.cardNumber == null || mentionsCardNumber(text, f.cardNumber), right: saysCardErrorRight(text, error) };
    });
    const good = calls.find((c) => c.number && c.right);
    const near = good ?? calls.find((c) => c.number || c.right) ?? calls[0];
    const onSiteVsCard = `в карточке ${error.inCard || error.what}, на месте ${error.onSite}`;
    const how = told
      ? `Наряд доложил об ошибке в ${hms(told.at)}`
      : arrived
        ? `Наряд прибыл на место около ${hms(arrived)}, доклад с места не принят`
        : "";
    const quoteCall = (c: { at: Date; text: string }) => `звонок в 112 в ${hms(c.at)}: ${quote(c.text)}`;
    const missing = (c: { number: boolean; right: boolean }) =>
      !c.number && !c.right ? "не названы номер карточки и верные сведения" : !c.number ? "не назван номер карточки" : `не названы верные сведения (${error.onSite})`;
    out.push({
      code: "dds.card_error_reported",
      group: "completeness",
      title: "Об ошибке в карточке сообщено в 112",
      ok: good ? true : arrived ? false : null,
      evidence: good
        ? cap([how, quoteCall(good)].filter(Boolean).join("; "))
        : arrived
          ? near
            ? `${how}; ${quoteCall(near)} — ${missing(near)}`
            : `${how} (${onSiteVsCard}), в 112 не звонили`
          : near
            ? `${cap(quoteCall(near))} — ${missing(near)}; наряд до места ещё не доехал`
            : f.dispatch
              ? `Наряд до места не доехал — об ошибке в карточке (${onSiteVsCard}) ещё не было известно`
              : `Наряд не направляли — ошибку в карточке (${onSiteVsCard}) некому было обнаружить`,
      expected: `Позвонить в 112 (набор «112»), назвать номер карточки и верные сведения: ${error.onSite}. Поля, заполненные службой 112, диспетчер ДДС не правит`,
      source: "rule",
    });
    if (closing && (arrived || good)) {
      const right = saysCardErrorRight(closing.comment ?? "", error);
      out.push({
        code: "dds.card_error_in_comment",
        group: "comments",
        title: "Итоги — по верным сведениям, а не по ошибке карточки",
        ok: right,
        evidence: `${STATUS_LABEL[closing.status]}: ${quote(closing.comment)}${right ? "" : ` — нет верных сведений (на месте ${error.onSite})`}`,
        expected: `В итоговом комментарии — как на самом деле: ${error.onSite}`,
        source: "rule",
      });
    }
  }

  // ── literacy: the refusal and final comments read without a phone call (rules; the model adds its own check) ──
  const judged = judgedComments(own);
  const issues = clarityIssues(judged, new Set(f.knownAbbreviations ?? []), noCrewClose ? NO_CREW_COMMENT : undefined);
  out.push({
    code: "dds.literacy",
    group: "literacy",
    title: "Комментарии понятны следующему диспетчеру",
    ok: judged.length ? issues.length === 0 : null,
    evidence: !judged.length
      ? "Комментария к отказу и итогового комментария ещё нет — проверять нечего"
      : issues.length
        ? issues.map((i) => `${STATUS_LABEL[i.status]}: ${i.fragment ? `«${i.fragment}»` : "без комментария"} — ${ISSUE_LABEL[i.kind]}`).join("; ")
        : `Замечаний нет: ${judged.map((c) => `${STATUS_LABEL[c.status]}: ${quote(c.text)}`).join("; ")}`,
    expected: issues.length
      ? [...new Set(issues.map((i) => i.hint))].join(". ")
      : "Полными фразами: что сделано, чем закончилось, кому передано; без своих сокращений",
    source: "rule",
  });

  return out;
}

export function summarize(criteria: CriterionResult[], score: number | null): string {
  const failed = criteria.filter((c) => c.ok === false);
  const passed = criteria.filter((c) => c.ok === true).length;
  const points = score !== null ? ` Балл ${score}.` : "";
  if (!failed.length && !passed) return "Проверять пока нечего: карточка ещё не обработана, а нормативы не истекли.";
  if (!failed.length) return `Замечаний нет: ${countLabel(passed, ["проверка пройдена", "проверки пройдены", "проверок пройдено"])}.${points}`;
  return `Пройдено ${passed} из ${passed + failed.length}. Ошибки: ${failed.map(errorTitle).join("; ")}.${points}`;
}

export function scoreOf(criteria: CriterionResult[], weights: Weights): number | null {
  return computeScore(criteria, weights);
}
