/**
 * Which approved scenarios can be the practice and the control of a follow-up for one student — the same rules the
 * live card flow and the call queue apply, so an assigned case is always dealt and judged on the student's place.
 *
 * 112, «уточнить и записать место»: any approved call with a reference address down to the house (otherwise the
 * address checks do not apply), of difficulty close to the call the error was made on. Not the source situation nor
 * its «-ош» variant, not a variant with an error in the ДДС card (for the operator it is the same call), not a repeat
 * call (it rings only after the first card of its incident), not a silent or dropping line.
 *
 * ДДС, «отразить доклад бригады»: a card the place's service accepts and whose crew reports on the work — the
 * reference for this service (or for its territorial level) says «Принята» with a crew. A district or prefecture
 * place gets the card on its territory: the situation happens there, or its house can move there (dds/territory.ts).
 * A variant with an error in the card adds another task and is left out.
 *
 * A control case must be new to the student (any seat, any role). A case prepared by the methodologist as a control
 * of another goal stays reserved for it.
 */
import { crewExpected, ddsCardOf, hasCardError, referenceFor, territorialLevel } from "@/lib/dds/scenario";
import { hasStreets, movable, placeOfAddress, territoryMatch, territoryOf } from "@/lib/dds/territory";
import { situationOf } from "@/lib/scenarios/pairs";
import { learningMeta } from "./metadata";
import { hasPair, NEAR_DIFFICULTY, pairProblem, type CaseOption, type CasePool, type Skill } from "./pairing";

export type PoolScenario = {
  id: string;
  ticketRef: string | null;
  title: string;
  difficulty: number;
  status: string;
  caller: unknown;
  truth: unknown;
  ddsCard: unknown;
  ddsReference: unknown;
  learningMeta: unknown;
};

export type PoolService = { id: number; shortName: string; okrug?: string | null; district?: string | null };

export const poolScenarioSelect = {
  id: true,
  ticketRef: true,
  title: true,
  difficulty: true,
  status: true,
  caller: true,
  truth: true,
  ddsCard: true,
  ddsReference: true,
  learningMeta: true,
} as const;

const ROLE_OF: Record<Skill, "OP112" | "DDS"> = { "op112.location": "OP112", "dds.report_record": "DDS" };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The situation keys of a scenario: a copy with the same case key or the other half of a ticket pair is the same case. */
export function caseKeys(s: { id: string; ticketRef: string | null; learningMeta: unknown }): string[] {
  const meta = learningMeta(s.learningMeta);
  return [`situation:${situationOf(s)}`, ...(meta ? [`case:${meta.caseKey}`] : [])];
}

export type Misfit = "status" | "reserved" | "card_error" | "repeat" | "line" | "no_caller" | "no_address" | "no_card" | "territory" | "reference";

/** Why a scenario cannot train this goal at this place; null when it can. */
export function misfit(skill: Skill, s: PoolScenario, service: PoolService | null): Misfit | null {
  if (s.status !== "APPROVED") return "status";
  const role = ROLE_OF[skill];
  const meta = learningMeta(s.learningMeta);
  if (meta?.purpose === "control" && !(meta.role === role && meta.skillKeys.includes(skill))) return "reserved";
  if (role === "OP112") {
    if (hasCardError(s.ddsReference)) return "card_error";
    if (isObj(s.truth) && text(s.truth.repeatOf)) return "repeat";
    const caller = isObj(s.caller) ? s.caller : {};
    if (caller.line === "silent" || caller.line === "drops") return "line";
    if (!text(caller.fullName)) return "no_caller";
    const address = isObj(s.truth) && isObj(s.truth.address) ? s.truth.address : {};
    if (!text(address.street) || !(text(address.house) || text(address.building) || text(address.structure))) return "no_address";
    return null;
  }
  if (s.ddsCard === null || s.ddsCard === undefined) return "no_card";
  if (hasCardError(s.ddsReference)) return "card_error";
  if (!service) return "reference";
  const territory = territoryOf(service);
  if (territory) {
    const spec = ddsCardOf({ id: s.id, title: s.title, category: "", caller: s.caller, truth: s.truth, ddsCard: s.ddsCard, ddsReference: s.ddsReference });
    const where = territoryMatch(placeOfAddress(spec.address), territory);
    // The card flow moves an ordinary house onto the place's territory; a card that can neither be there nor move
    // there would come as another territory's card, where the right answer is «Не принята».
    if (where === "out" && !(movable(spec) && hasStreets(territory))) return "territory";
  }
  const ref = referenceFor(s.ddsReference, service);
  if (!ref || ref.decision !== "accept" || !crewExpected(ref)) return "reference";
  return null;
}

export type PoolContext = {
  /** The scenario the confirmed error was made on (null: the card came without a scenario). */
  source: PoolScenario | null;
  /** The service of the student's ДДС place; null for a 112 place. */
  service: PoolService | null;
  /** Situation keys the student has already met (followup/exposure.ts). */
  seen: ReadonlySet<string>;
};

function nearSource(skill: Skill, s: PoolScenario, source: PoolScenario | null): boolean {
  return ROLE_OF[skill] !== "OP112" || !source || Math.abs(s.difficulty - source.difficulty) <= NEAR_DIFFICULTY;
}

/** The reason a control is refused when the student has met its situation. */
export const SEEN = "ученик уже встречал эту ситуацию";

/** Why this scenario is not offered to this student for this purpose; null when it is. */
export function unsuitable(skill: Skill, s: PoolScenario, ctx: PoolContext, purpose: "practice" | "control"): string | null {
  const why = misfit(skill, s, ctx.service);
  if (why) return MISFIT_TEXT[why](ctx.service?.shortName ?? "");
  const keys = caseKeys(s);
  if (ctx.source && caseKeys(ctx.source).some((k) => keys.includes(k))) return "это та же ситуация, на которой была ошибка";
  if (!nearSource(skill, s, ctx.source)) return `сложность ${s.difficulty} не сопоставима с исходной (${ctx.source!.difficulty})`;
  const meta = learningMeta(s.learningMeta);
  if (purpose === "practice" && meta?.purpose === "control") return "это контрольный вариант: он не выдаётся для отработки";
  if (purpose === "control" && keys.some((k) => ctx.seen.has(k))) return SEEN;
  return null;
}

const MISFIT_TEXT: Record<Misfit, (service: string) => string> = {
  status: () => "сценарий не утверждён",
  reserved: () => "сценарий закреплён методистом за контролем другого навыка",
  card_error: () => "в сценарии ошибка в карточке ДДС — это другая задача",
  repeat: () => "это повторный вызов: он звучит только после карточки первого",
  line: () => "на линии тишина или звонок обрывается",
  no_caller: () => "в сценарии нет заявителя",
  no_address: () => "в эталоне нет адреса до дома — уточнение места не проверить",
  no_card: () => "у сценария нет карточки ДДС",
  territory: (service) => `карточку нельзя дать на территории «${service}»`,
  reference: (service) => `в эталоне нет решения «Принята» с бригадой для «${service}»`,
};

export function caseOption(skill: Skill, s: PoolScenario, ctx: PoolContext, purpose: "practice" | "control"): CaseOption {
  const meta = learningMeta(s.learningMeta);
  const forGoal = meta && meta.role === ROLE_OF[skill] && meta.skillKeys.includes(skill) ? meta : null;
  const keys = caseKeys(s);
  return {
    id: s.id,
    title: s.title,
    difficulty: s.difficulty,
    keys,
    group: forGoal?.equivalenceKey ?? null,
    marked: forGoal?.purpose === purpose,
    seen: keys.some((k) => ctx.seen.has(k)),
  };
}

/** Prepared cases first, then new to the student, then closest to the source difficulty. */
function ordered(options: CaseOption[], source: PoolScenario | null): CaseOption[] {
  const gap = (o: CaseOption) => (source ? Math.abs(o.difficulty - source.difficulty) : 0);
  return [...options].sort((a, b) => Number(b.marked) - Number(a.marked) || Number(a.seen) - Number(b.seen) || gap(a) - gap(b) || a.title.localeCompare(b.title, "ru"));
}

/** Practice and control options for one student, and in plain words why there is no pair when there is none. */
export function buildPool(skill: Skill, scenarios: PoolScenario[], ctx: PoolContext): CasePool {
  const suitable = ordered(scenarios.filter((s) => unsuitable(skill, s, ctx, "practice") === null).map((s) => caseOption(skill, s, ctx, "practice")), ctx.source);
  const control = ordered(scenarios.filter((s) => unsuitable(skill, s, ctx, "control") === null).map((s) => caseOption(skill, s, ctx, "control")), ctx.source);
  const pool = { practice: suitable, control };
  if (!hasPair(ROLE_OF[skill], pool)) return { ...pool, practice: suitable, problem: poolProblem(skill, scenarios, ctx, pool) };
  // A practice case that would leave no control to pair with (say, the only new case) is not offered for practice.
  const practice = suitable.filter((p) => control.some((c) => pairProblem(ROLE_OF[skill], p, c) === null));
  return { practice, control, problem: null };
}

function range(source: PoolScenario | null): string {
  return source ? `сложности ${Math.max(1, source.difficulty - NEAR_DIFFICULTY)}–${Math.min(10, source.difficulty + NEAR_DIFFICULTY)}` : "";
}

/** The reason for an empty choice and what the teacher can do about it. */
function poolProblem(skill: Skill, scenarios: PoolScenario[], ctx: PoolContext, pool: Pick<CasePool, "practice" | "control">): string {
  const source = ctx.source ? `«${ctx.source.title}»` : "исходной";
  const where = "в разделе «Сценарии»";
  if (ROLE_OF[skill] === "OP112") {
    if (!pool.practice.length) {
      return `Нет другого утверждённого вызова 112 ${range(ctx.source)} с адресом до дома: исходный ${source} и его варианты не подходят. Утвердите ещё один сценарий ${where} или назначьте повторную тренировку обычным занятием.`.replace(/\s+/g, " ");
    }
    return `Для контроля нужен ещё один утверждённый вызов ${range(ctx.source)}, которого ученик не слышал и который отличается от отработки: подходящих нет — ученик их уже встречал или вариант один. Утвердите ещё один сценарий ${where}.`.replace(/\s+/g, " ");
  }
  const service = ctx.service?.shortName ?? "служба места";
  if (!pool.practice.length) {
    const reasons = scenarios.map((s) => misfit(skill, s, ctx.service));
    const noCrew = reasons.filter((r) => r === "reference").length;
    const offTerritory = reasons.filter((r) => r === "territory").length;
    const prefecture = ctx.service && territorialLevel(ctx.service.shortName) === "prefecture";
    if (prefecture && noCrew >= offTerritory) {
      return `У ДДС префектуры («${service}») в эталонах сценариев нет своей бригады и докладов о работах, поэтому навык «Отразить доклад бригады» на этом месте не отработать. Добавьте в эталон сценария решение «Принята» с бригадой для ДДС префектуры ${where} или назначьте отработку ученикам районной ДДС или городской службы.`;
    }
    return `Для «${service}» нет другого утверждённого случая, кроме исходного ${source}, где эта служба принимает карточку, бригада докладывает о работах и карточку можно дать на её территории. Добавьте эталон действий этой службы (решение «Принята», цепочка статусов) ещё в один сценарий ${where}.`;
  }
  return `Для контроля нужен ещё один случай для «${service}», новый для ученика и отличный от отработки: подходящие он уже встречал или случай один. Добавьте эталон действий этой службы ещё в один сценарий ${where}.`;
}
