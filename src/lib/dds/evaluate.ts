/**
 * Review of one ДДС plate against the dispatcher memo's error catalogue (report D4) — rules only, no model.
 * Each check becomes a CriterionResult of a weight group; «не применимо» is ok: null and does not count.
 *
 *   timeliness   — answer within ackSec; crew sent within workSec; crew calls answered; status after a report
 *   comments     — reason and «кому передано» for Не принята / Отказ; meaningful final comment
 *   statusOrder  — progress statuses not skipped; statuses by the facts of reports; status matches its meaning;
 *                  the card closed with the right status
 *   services     — the decision matches the scenario's reference for this service
 *   completeness — callback to the applicant without the card number (#740)
 *   literacy     — comments are clear to the next dispatcher: rules here (clarity.ts); with a model
 *                  configured the review adds the model's own check (clarity-ai.ts)
 */
import type { ServiceStatus } from "@prisma/client";
import { computeScore, type CriterionResult, type Weights } from "@/lib/scoring/score";
import { describeTemplates, matchTemplate, parseTemplates, templateProblem } from "@/lib/scoring/template";
import { clarityIssues, judgedComments, type ClarityIssue } from "./clarity";
import { crewPlanFor, crewSchedule, REPORT_REACT_SEC, stageAt, type Dispatch } from "./crew";
import { fmtDuration, fmtDateTime } from "./format";
import { crewExpected, type DdsReferenceEntry } from "./scenario";
import { awaitsAnswer, NO_CREW_COMMENT, PROGRESS, STATUS_LABEL, type ServiceRules } from "./status";

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
  /** Incoming crew calls: rang / lost. */
  crewCalls: { rang: number; missed: number };
  callbacks: { at: Date; namedCardNumber: boolean }[];
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

/** A must-have of the reference («что сделано: перекрыт кран») is covered when a stem of its words is in the comment. */
export function phraseCovered(comment: string, phrase: string): boolean {
  const text = comment.toLowerCase().replace(/ё/g, "е");
  const p = phrase.toLowerCase().replace(/ё/g, "е");
  if (/время/.test(p) && /\b\d{1,2}[:.]\d{2}\b/.test(text)) return true;
  if (/(кому|передан)/.test(p) && TRANSFER.test(comment)) return true;
  const words = (p.match(/[а-я]{4,}/g) ?? []).filter((w) => !STOP_WORD.test(w));
  if (!words.length) return text.trim().length > 0;
  return words.some((w) => text.includes(w.slice(0, Math.max(4, Math.min(6, w.length - 2)))));
}

export function evaluateDdsPlate(f: PlateFacts): CriterionResult[] {
  const out: CriterionResult[] = [];
  const own = f.events.filter((e) => !awaitsAnswer(e.status));
  const first = own[0] ?? null;
  const { decision, event: decisionEvent } = decisionOf(f.events, f.rules);
  const closing = own.find((e) => e.status === "FINISHED" || e.status === "REFUSED") ?? null;
  const noCrewClose = f.rules.noReject && first?.status === "FINISHED";
  const ref = f.reference;

  // ── timeliness ──
  if (first) {
    const delay = secBetween(f.addedAt, first.at);
    out.push({
      code: "dds.ack_in_time",
      group: "timeliness",
      title: `Ответ «Принята / Не принята» за ${f.ackSec} с`,
      ok: delay <= f.ackSec,
      evidence: `«${STATUS_LABEL[first.status]}» через ${fmtDuration(delay)} после «Добавлена» (норматив ${fmtDuration(f.ackSec)})`,
      expected: `Первый статус — в течение ${f.ackSec} с после «Добавлена», даже если карточка ещё в очереди`,
      source: "rule",
    });
  } else {
    // A card that came in just before the end still had time left: nothing to judge yet.
    const waited = secBetween(f.addedAt, f.now);
    const expired = waited > f.ackSec;
    out.push({
      code: "dds.ack_in_time",
      group: "timeliness",
      title: `Ответ «Принята / Не принята» за ${f.ackSec} с`,
      ok: expired ? false : null,
      critical: expired,
      evidence: expired
        ? `Ответа нет: карточка получает статус «Не оповещено» (прошло ${fmtDuration(waited)})`
        : `Карточка пришла за ${fmtDuration(waited)} до конца — норматив ещё не истёк`,
      expected: "Поставить «Принята» или «Не принята» в течение норматива",
      source: "rule",
    });
  }

  if (decision === "accept" && !noCrewClose && crewExpected(ref)) {
    const sent = f.dispatch ? secBetween(f.addedAt, f.dispatch.at) : null;
    const stillTime = sent === null && secBetween(f.addedAt, f.now) <= f.workSec;
    out.push({
      code: "dds.crew_in_time",
      group: "timeliness",
      title: `Наряд направлен в пределах отработки (${fmtDuration(f.workSec)})`,
      ok: stillTime ? null : sent !== null && sent <= f.workSec,
      evidence:
        sent === null
          ? "Наряд не назначен: номер наряда не указан, по телефону наряд не направлен"
          : `Наряд ${f.dispatch!.crew} ${f.dispatch!.via === "phone" ? "направлен по телефону" : "указан в статусе"} через ${fmtDuration(sent)}`,
      expected: "После «Принята» выбрать наряд и указать его номер в статусе",
      source: "rule",
    });
  }

  if (f.crewCalls.rang > 0) {
    out.push({
      code: "dds.crew_calls_answered",
      group: "timeliness",
      title: "Звонки наряда приняты",
      ok: f.crewCalls.missed === 0,
      evidence: f.crewCalls.missed ? `Пропущено докладов: ${f.crewCalls.missed} из ${f.crewCalls.rang}` : `Приняты все доклады: ${f.crewCalls.rang}`,
      expected: "Отвечать на звонки старшего наряда; пропустили — перезвонить самим",
      source: "rule",
    });
  }

  // The first report of each stage counts; the crew may repeat itself when asked again.
  const reports = [...f.reports]
    .filter((r): r is { status: ServiceStatus; at: Date } => r.status !== "DISPATCHED")
    .sort((a, b) => a.at.getTime() - b.at.getTime())
    .filter((r, i, all) => all.findIndex((x) => x.status === r.status) === i);
  if (reports.length) {
    const late: string[] = [];
    let judged = 0;
    for (const r of reports) {
      const done = own.find((e) => RANK[e.status] >= RANK[r.status] && e.status !== "REJECTED" && e.at.getTime() >= r.at.getTime() - 5_000);
      const before = own.find((e) => RANK[e.status] >= RANK[r.status] && e.status !== "REJECTED" && e.at < r.at);
      if (before) continue; // already set earlier (checked by «по факту докладов»)
      if (!done && secBetween(r.at, f.now) <= REPORT_REACT_SEC) continue; // the report came just before the end
      judged++;
      if (!done || secBetween(r.at, done.at) > REPORT_REACT_SEC) {
        late.push(`доклад «${STATUS_LABEL[r.status]}» в ${fmtDateTime(r.at).slice(11)} — ${done ? `статус через ${fmtDuration(secBetween(r.at, done.at))}` : "статус не поставлен"}`);
      }
    }
    out.push({
      code: "dds.status_after_report",
      group: "timeliness",
      title: "Статус поставлен сразу после доклада наряда",
      ok: judged === 0 ? null : late.length === 0,
      evidence: late.length
        ? late.join("; ")
        : judged
          ? `Все доклады (${judged}) отражены статусами в течение ${REPORT_REACT_SEC} с`
          : "Доклад пришёл перед самым концом — время на статус ещё было",
      expected: `Не позже ${REPORT_REACT_SEC} с после доклада поставить соответствующий статус с комментарием`,
      source: "rule",
    });
  }

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
    const meaningful = text.length >= (noCrewClose ? NO_CREW_COMMENT.length - 5 : 20) && !GENERIC_FINAL.test(text);
    out.push({
      code: "dds.final_comment",
      group: "comments",
      title: "Итоговый комментарий содержательный",
      ok: meaningful && noCrewOk,
      evidence: `${STATUS_LABEL[closing.status]}: ${quote(closing.comment)}`,
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
    const hit = ref.finalMust.filter((p) => phraseCovered(text, p));
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
    const schedule = crewSchedule(chain, f.workSec);
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
    const schedule = crewSchedule(chain, f.workSec);
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
  if (!failed.length) return `Замечаний нет: пройдено проверок ${passed}.${score !== null ? ` Балл ${score}.` : ""}`;
  return `Пройдено ${passed} из ${passed + failed.length}. Ошибки: ${failed.map((c) => c.title.toLowerCase()).join("; ")}.${score !== null ? ` Балл ${score}.` : ""}`;
}

export function scoreOf(criteria: CriterionResult[], weights: Weights): number | null {
  return computeScore(criteria, weights);
}
