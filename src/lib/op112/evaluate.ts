/**
 * Review of a 112 operator's card: the card against the scenario's reference answer and — the main
 * part — against what the caller actually said in the conversation («сказал ↔ заполнил»).
 *
 * Rules always run and are deterministic. With a language model configured, two extra checks read
 * the transcript (missed statements, clarity of the description); without a model they stay
 * «не применимо» (ok = null) and do not affect the score.
 */
import { z } from "zod";
import { aiMode, chatJson, type ChatMessage } from "@/lib/ai/provider";
import { guidanceText, type CorrectionContext, type GuidanceRow } from "@/lib/review/corrections";
import { CALLER_STATUSES, type IncidentAddress, type IncidentCaller, type IncidentFlags } from "@/lib/incident/types";
import { compareStreets as compareKnownStreets } from "@/lib/routing/address";
import type { CriterionResult, WeightGroup } from "@/lib/scoring/score";
import { findKind, kindTitle } from "./catalog";
import { evidenced, factCards, findAsked, keywordRegex, low, normalizeQuestion } from "./facts";
import { addressLine, compareStreets as compareOwnStreets, normHouse } from "./gazetteer";
import type { Persona } from "./caller";
import type { ServiceLite } from "./routing";
import type { CallLine, FactCard, ScenarioTruth, StoredTag } from "./types";

export type EvalCard = {
  caller: IncidentCaller;
  address: IncidentAddress;
  flags: IncidentFlags;
  tags: StoredTag[];
  cards: string[];
  typeCodes: number[];
  description: string;
  openedAt: Date | null;
  savedAt: Date | null;
  empty?: "noContact" | "dropped";
};

export type EvalInput = {
  card: EvalCard;
  serviceIds: number[];
  persona: Persona | null;
  truth: ScenarioTruth | null;
  /** reference plates: the scenario's list, or what the engine picks for the reference card */
  expectedServices: number[];
  messages: CallLine[];
  typingSec: number;
  catalog: ServiceLite[];
  /** «Класс.» names for the leaves on the card and in the reference */
  typeNames: Record<number, string>;
  /** flags the chosen panels can set at all (top buttons included); absent — any flag */
  settableFlags?: string[];
};

// ─── Reference answer ────────────────────────────────────────────────────────

const ids = z.array(z.number()).catch([]);
const truthSchema = z.object({
  kind: z.string().optional().catch(undefined),
  cards: z.array(z.string()).optional().catch(undefined),
  typeCodes: ids,
  acceptableTypeCodes: ids,
  finalType: z.string().optional().catch(undefined),
  tags: z.array(z.unknown()).catch([]),
  flags: z.record(z.string(), z.boolean()).catch({}),
  address: z.record(z.string(), z.string().nullable()).catch({}),
  services: z.array(z.union([z.number(), z.string(), z.object({ serviceId: z.number() }).passthrough()])).catch([]),
  requiredQuestions: z
    .array(z.union([z.string(), z.object({ text: z.string(), topic: z.string().optional(), keywords: z.array(z.string()).optional() })]))
    .catch([]),
  callerStatus: z.enum(CALLER_STATUSES).optional().catch(undefined),
  descriptionKeywords: z.array(z.string()).optional().catch(undefined),
  traps: z.array(z.string()).catch([]),
  emptyCall: z.enum(["noContact", "dropped"]).optional().catch(undefined),
});

// What the gist of a kind sounds like in the first 100 characters of the description.
const KIND_GIST: Record<string, string> = {
  "101": "гор|пожар|пламя|дым|задым|возгоран|огон|сигнализац",
  "104": "газ",
  ДТП: "дтп|авари|столкн|наезд|сбил|врезал",
  Взрыв: "взрыв|взорв|хлоп",
};
const TAG_GIST: [RegExp, string][] = [
  [/газ/, "газ"],
  [/общественн|автобус/, "автобус|троллейбус|трамва|маршрут|транспорт"],
  [/автомашин|автомобил/, "машин|автомоб|а/м|авто|тойот|ваз|иномарк"],
  [/драк/, "драк|дерут|дерет|избива"],
  [/хулиган/, "хулиган|громят|разбил|бит"],
  [/подозрит|предмет/, "предмет|коробк|сумк|пакет|подозрит"],
];
const GENERIC_TAGS = /^(на улице|жилой дом|транспорт|открытое пламя|дым|пламя|сигнализация|квартира)$/;

function gistFromTags(tags: unknown[]): string | undefined {
  for (const raw of tags) {
    if (typeof raw !== "string") continue;
    const t = low(raw).trim();
    if (GENERIC_TAGS.test(t)) continue;
    const mapped = TAG_GIST.find(([re]) => re.test(t));
    if (mapped) return mapped[1];
    const word = t.split(/[^а-яa-z]+/).sort((a, b) => b.length - a.length)[0];
    if (word && word.length >= 4) return word.slice(0, Math.min(5, word.length));
  }
  return undefined;
}

/** Scenario.truth from any editor → the shape the checks use; unknown or broken parts become empty. */
export function normalizeTruth(raw: unknown, catalog: ServiceLite[] = []): ScenarioTruth | null {
  if (!raw || typeof raw !== "object") return null;
  const t = truthSchema.parse(raw);
  const kind = t.kind ?? t.cards?.[0];
  const services = t.services
    .map((s) => (typeof s === "number" ? s : typeof s === "string" ? catalog.find((c) => c.shortName === s)?.id : s.serviceId))
    .filter((id): id is number => typeof id === "number");
  const address = Object.fromEntries(Object.entries(t.address).filter(([, v]) => typeof v === "string" && v)) as IncidentAddress;
  const keywords = t.descriptionKeywords ?? [kind ? KIND_GIST[kind] : undefined, gistFromTags(t.tags)].filter((k): k is string => Boolean(k));
  return {
    kind,
    typeCodes: t.typeCodes,
    acceptableTypeCodes: t.acceptableTypeCodes,
    finalType: t.finalType,
    flags: t.flags as IncidentFlags,
    address,
    services,
    requiredQuestions: t.requiredQuestions.map((q) => normalizeQuestion(q as never)),
    callerStatus: t.callerStatus,
    descriptionKeywords: keywords,
    traps: t.traps,
    emptyCall: t.emptyCall,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const yesNo = (v: boolean | undefined) => (v ? "да" : "нет");
const quote = (s: string, max = 140) => `«${s.length > max ? `${s.slice(0, max - 1)}…` : s}»`;
const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);
const same = (a: string | undefined, b: string | undefined) => low(a ?? "").trim() === low(b ?? "").trim();
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${sec % 60 < 10 ? "0" : ""}${sec % 60}`;

const FLAG_TITLE: Record<string, string> = {
  victims: "Пострадавшие",
  refusedAmbulance: "Нет на месте / Отказ от скорой",
  noAccess: "Нет доступа / Заблокированные",
  threat: "Угроза людям",
  gas: "Проведена ли газификация",
  offense: "Правонарушение",
  med: "Медицинская помощь",
  evac: "Требуется эвакуация",
  traffic: "Перекрытие движения",
};

/**
 * A known look-alike street («Дубнинская» for «Дубининская») or the same name of another kind of
 * street is critical: the crew goes to another part of the city. A typo is a plain mistake.
 */
export function streetVerdict(filled: string | undefined, truth: string): "same" | "lookalike" | "typo" | "other" | "empty" {
  if (!filled?.trim()) return "empty";
  const known = compareKnownStreets(filled, truth);
  if (known.verdict === "same") return "same";
  if (known.verdict === "confusable" && known.pair) return "lookalike";
  const own = compareOwnStreets(filled, truth);
  if (own === "same" || own === "lookalike") return own;
  return known.verdict === "confusable" || own === "typo" ? "typo" : "other";
}

function tagMatches(card: EvalCard, row: string, value: string): boolean {
  const options = value.split("|").map((v) => low(v).trim());
  return card.tags.some((t) => {
    if (t.row !== row) return false;
    const v = low(t.text ?? t.value).trim();
    return options.some((o) => v === o || (/^\d+$/.test(o) ? v.replace(/\D/g, "") === o : v.includes(o)));
  });
}

function filledTag(card: EvalCard, row: string): string {
  return card.tags
    .filter((t) => t.row === row)
    .map((t) => t.text ?? t.value)
    .join(", ");
}

function descriptionMisses(description: string, keywords: string[]): string[] {
  const d = low(description);
  return keywords.filter((k) => !(keywordRegex(k)?.test(d) ?? false));
}

/** Flags of the three top buttons: an unpressed button means «нет». */
const TOP = new Set(["victims", "refusedAmbulance", "noAccess"]);

/**
 * Does the card hold this flag value? «Нет» on a panel row must be chosen explicitly: a row nobody
 * answered is not «нет газа», and «Нет данных» is not «нет» either.
 */
function flagHolds(card: EvalCard, flag: keyof IncidentFlags, value: boolean): boolean {
  const filled = card.flags[flag];
  if (value) return filled === true;
  if (TOP.has(flag)) return !filled;
  if (flag === "gas" && card.tags.some((t) => t.row === "Проведена ли газификация" && (t.text ?? t.value) === "Нет данных")) return false;
  return filled === false;
}

function flagText(card: EvalCard, flag: keyof IncidentFlags): string {
  const v = card.flags[flag];
  if (v === true) return "да";
  if (v === false) return "нет";
  return TOP.has(flag) ? "нет" : "не отмечено";
}

// ─── Rule checks ─────────────────────────────────────────────────────────────

export function evaluateOp112Rules(input: EvalInput): CriterionResult[] {
  const { card, truth, persona, messages } = input;
  const out: CriterionResult[] = [];
  const add = (code: string, group: WeightGroup, title: string, ok: boolean | null, extra: Partial<CriterionResult> = {}) =>
    out.push({ code, group, title, ok, source: "rule", ...extra });

  const operatorLines = messages.filter((m) => m.role === "trainee").map((m) => m.text);
  const facts = persona ? factCards(persona) : [];
  const revealed = new Map<string, { fact: FactCard; line: CallLine }>();
  for (const f of facts) {
    const line = messages.find((m) => m.role === "counterpart" && m.revealed?.includes(f.key));
    if (line) revealed.set(f.key, { fact: f, line });
  }

  // An empty card («нет контакта» / «срыв звонка») for a caller who was on the line is a critical mistake.
  if (card.empty) {
    const expected = truth?.emptyCall;
    add("op112.empty", "completeness", "Карточка не сохранена пустой по ошибке", expected ? expected === card.empty : false, {
      critical: !expected,
      evidence: `Нажато «${card.empty === "noContact" ? "нет контакта" : "срыв звонка"}»${messages.some((m) => m.role === "counterpart") ? ", хотя заявитель был на линии" : ""}`,
      expected: expected ? undefined : "Вернуться к заполнению и завести карточку по словам заявителя",
    });
    return out;
  }

  // Time to «сохранить».
  if (card.openedAt && card.savedAt) {
    const sec = Math.max(0, Math.round((card.savedAt.getTime() - card.openedAt.getTime()) / 1000));
    add("op112.typing_time", "timeliness", `Карточка сохранена за ${mmss(sec)}`, sec <= input.typingSec, {
      evidence: `Норматив набора — ${mmss(input.typingSec)}; таймер ${sec <= input.typingSec ? "не покраснел" : "покраснел"}`,
    });
  } else {
    add("op112.typing_time", "timeliness", "Время набора карточки", null);
  }

  // Address against the clarified place.
  if (truth && Object.keys(truth.address).length) {
    const t = truth.address;
    const f = card.address;
    const exact = revealed.get("addressExact");
    const said = exact ? `Заявитель уточнил: ${quote(exact.line.text)}` : persona?.hiddenAddress ? `Адрес не уточнён: заявитель назвал только ${quote(persona.visibleAddress)}` : "";
    if (t.street) {
      const verdict = streetVerdict(f.street, t.street);
      add("op112.address.street", "address", "Улица совпадает с местом происшествия", verdict === "same", {
        critical: verdict === "lookalike",
        evidence: [
          verdict === "empty" ? "Улица не заполнена" : `В карточке: ${quote(f.street ?? "")}`,
          verdict === "lookalike" ? "Похожее название, но это другая улица — бригада уедет не туда" : "",
          verdict === "typo" ? "Название улицы записано с ошибкой" : "",
          said,
        ]
          .filter(Boolean)
          .join(". "),
        expected: t.street,
      });
    }
    const houseParts: [keyof IncidentAddress, string][] = [
      ["house", "дом"],
      ["building", "корпус"],
      ["structure", "строение"],
    ];
    const wanted = houseParts.filter(([k]) => t[k]);
    if (wanted.length) {
      const wrong = wanted.filter(([k]) => normHouse(f[k]) !== normHouse(t[k]));
      add("op112.address.house", "address", "Дом, корпус, строение", wrong.length === 0, {
        evidence: wrong.length
          ? `${wrong.map(([k, l]) => `${l}: ${f[k] ? quote(f[k]!) : "пусто"}`).join("; ")}${exact ? `. ${said}` : ""}`
          : `${wanted.map(([k, l]) => `${l} ${f[k]}`).join(", ")}`,
        expected: wanted.map(([k, l]) => `${l} ${t[k]}`).join(", "),
      });
    }
    if (t.district) {
      const ok = same(f.district?.replace(/ё/g, "е"), t.district.replace(/ё/g, "е"));
      add("op112.address.district", "address", "Район определён верно", ok, {
        evidence: f.district ? `В карточке: ${f.okrug ?? ""} ${f.district}`.trim() : "Район не определён — территориальные службы не подтянутся",
        expected: `${t.okrug ?? ""} ${t.district}`.trim(),
      });
    } else if (t.city || t.subject) {
      add("op112.address.region", "address", "Населённый пункт и субъект", same(f.city, t.city) && same(f.subject, t.subject), {
        evidence: `В карточке: ${[f.subject, f.city].filter(Boolean).join(", ") || "пусто"}`,
        expected: [t.subject, t.city].filter(Boolean).join(", "),
      });
    }
    const details: [keyof IncidentAddress, string][] = [
      ["flat", "квартира"],
      ["entrance", "подъезд"],
      ["floor", "этаж"],
      ["code", "код"],
    ];
    const needDetails = details.filter(([k]) => t[k]);
    if (needDetails.length) {
      const wrong = needDetails.filter(([k]) => normHouse(f[k]) !== normHouse(t[k]));
      add("op112.address.details", "address", "Квартира, подъезд, этаж, код", wrong.length === 0, {
        evidence: wrong.length ? `Не так или пусто: ${wrong.map(([k, l]) => `${l} (${f[k] || "пусто"})`).join(", ")}` : "Заполнено",
        expected: needDetails.map(([k, l]) => `${l} ${t[k]}`).join(", "),
      });
    }
  }

  // «Что случилось» and the classification it leads to.
  if (truth?.kind) {
    const expected = findKind(truth.kind)?.name ?? truth.kind;
    const ok = card.cards.some((c) => same(findKind(c)?.name ?? c, expected));
    add("op112.type", "services", "Тип происшествия («что случилось»)", ok, {
      evidence: card.cards.length ? `Выбрано: ${card.cards.map(kindTitle).join(", ")}` : "Тип не выбран",
      expected: kindTitle(expected),
    });
  }
  if (truth?.typeCodes.length) {
    const accepted = new Set([...truth.typeCodes, ...truth.acceptableTypeCodes]);
    const ok = card.typeCodes.some((c) => accepted.has(c));
    const name = (c: number) => input.typeNames[c] ?? String(c);
    add("op112.class", "services", "Классификация по опросной карте («Класс.»)", ok, {
      evidence: card.typeCodes.length ? `В карточке: ${card.typeCodes.map(name).join("; ")}` : "Опросная карта не доведена до вида происшествия",
      expected: truth.finalType ?? truth.typeCodes.map(name).join("; "),
    });
  }

  // Flags of the reference. What the caller said is checked below; a fact the caller never said is
  // the missed question, not a wrong flag; a flag no chosen panel can set is «не применимо».
  const flagFacts = facts.filter((f) => f.expect?.kind === "flag");
  const saidFlags = new Set(
    [...revealed.values()].filter((r) => r.fact.expect?.kind === "flag").map((r) => (r.fact.expect as { flag: string }).flag),
  );
  for (const [key, value] of Object.entries(truth?.flags ?? {})) {
    if (typeof value !== "boolean" || saidFlags.has(key)) continue;
    if (flagFacts.some((f) => (f.expect as { flag: string }).flag === key)) continue;
    const flag = key as keyof IncidentFlags;
    const settable = !input.settableFlags || TOP.has(key) || input.settableFlags.includes(key);
    add(`op112.flag.${key}`, "services", `Флаг «${FLAG_TITLE[key] ?? key}»`, settable ? flagHolds(card, flag, value) : null, {
      evidence: settable ? `В карточке: ${flagText(card, flag)}` : "В выбранной опросной карте такой строки нет",
      expected: yesNo(value),
    });
  }

  // Services against the reference list.
  if (truth) {
    const expected = input.expectedServices;
    const name = (id: number) => input.catalog.find((c) => c.id === id)?.shortName ?? `#${id}`;
    const visible = new Set(input.catalog.map((c) => c.id));
    const shown = expected.filter((id) => visible.has(id));
    const missing = shown.filter((id) => !input.serviceIds.includes(id));
    const extra = input.serviceIds.filter((id) => !expected.includes(id));
    add("op112.services.missing", "services", "Оповещены все нужные службы", shown.length ? missing.length === 0 : null, {
      evidence: missing.length ? `Не хватает: ${missing.map(name).join(", ")}` : "Все нужные службы в карточке",
      expected: shown.map(name).join(", "),
    });
    add("op112.services.extra", "services", "Нет лишних служб", extra.length === 0, {
      evidence: extra.length ? `Лишние: ${extra.map(name).join(", ")}` : "Лишних нет",
    });
  }

  // Required fields (the instruction lists description, name, caller status and victims).
  const statusSaid = revealed.get("status");
  add("op112.field.fullName", "completeness", "Заполнена фамилия и имя заявителя", Boolean(card.caller.fullName?.trim()), {
    evidence: card.caller.fullName ? quote(card.caller.fullName) : "Пусто — после сохранения исправить нельзя",
  });
  const statusOk = Boolean(card.caller.status) && (Boolean(statusSaid) || !truth?.callerStatus || card.caller.status === truth.callerStatus);
  add("op112.field.status", "completeness", "Выбран статус заявителя", statusOk, {
    evidence: card.caller.status ? `Выбрано: ${card.caller.status}` : "Статус не выбран",
    expected: !statusSaid && truth?.callerStatus ? truth.callerStatus : undefined,
  });
  add("op112.field.phone", "completeness", "Заполнен предоставленный телефон", Boolean(digits(card.caller.provided)), {
    evidence: card.caller.provided ? card.caller.provided : "Пусто: можно было скопировать АОН кнопкой «АОН»",
  });
  add("op112.field.description", "completeness", "Заполнено описание со слов заявителя", card.description.trim().length >= 10, {
    evidence: card.description.trim() ? `${card.description.trim().length} знаков` : "Описание пустое",
  });

  // Required questions, judged by the operator's own lines.
  (truth?.requiredQuestions ?? []).forEach((q, i) => {
    const line = findAsked(q, operatorLines);
    add(`op112.question.${i + 1}`, "completeness", `Задан вопрос: ${q.text}`, Boolean(line), {
      evidence: line ? `Оператор: ${quote(line)}` : "Вопрос не прозвучал",
    });
  });

  // The first 100 characters go to service 103: the gist, and victims if any.
  const first = card.description.trim().slice(0, 100);
  const need = [...(truth?.descriptionKeywords ?? [])];
  if (card.flags.victims || truth?.flags.victims) need.push("пострадав|сознан|травм|ранен|плохо|ожог|кров");
  if (need.length) {
    const miss = descriptionMisses(first, need);
    add("op112.description.first100", "literacy", "Суть и пострадавшие — в первых 100 символах описания", first ? miss.length === 0 : false, {
      evidence: first ? `В 103 уйдёт: ${quote(first, 110)}` : "Описание пустое",
      expected: miss.length ? `Добавить в начало: ${miss.map((m) => m.split("|")[0]).join(", ")}` : undefined,
    });
  }

  // «Сказал ↔ заполнил»: every fact the caller said must be in the card.
  for (const { fact, line } of revealed.values()) {
    const e = fact.expect;
    if (!e || e.kind === "address") continue;
    const said = `Заявитель: ${quote(line.text)}`;
    const title = `Сказал ↔ заполнил: ${fact.label}`;
    const code = `op112.said.${fact.key}`;
    if (e.kind === "flag") {
      const settable = !input.settableFlags || TOP.has(e.flag) || input.settableFlags.includes(e.flag);
      // A flag the chosen panel has no row for has to be written in the description instead.
      add(code, "services", title, settable ? flagHolds(card, e.flag, e.value) : evidenced(fact, card.description), {
        evidence: `${said} → в карточке «${FLAG_TITLE[e.flag] ?? e.flag}»: ${flagText(card, e.flag)}`,
        expected: `«${FLAG_TITLE[e.flag] ?? e.flag}»: ${yesNo(e.value)}`,
      });
    } else if (e.kind === "tag") {
      // A panel row, or the same words in the description when the panel has no such row.
      const ok = tagMatches(card, e.row, e.value) || descriptionMisses(card.description, [low(e.value)]).length === 0;
      add(code, "services", title, ok, {
        evidence: `${said} → «${e.row}»: ${filledTag(card, e.row) || "не заполнено"}`,
        expected: `«${e.row}»: ${e.value.split("|")[0]}`,
      });
    } else if (e.kind === "description") {
      const miss = descriptionMisses(card.description, e.keywords);
      add(code, "literacy", title, miss.length === 0, {
        evidence: `${said} → ${miss.length ? "в описании этого нет" : "есть в описании"}`,
        expected: miss.length ? `Записать в описание: ${fact.text}` : undefined,
      });
    } else if (e.kind === "name") {
      const surname = low(persona?.fullName.split(/\s+/)[0] ?? "");
      const ok = Boolean(surname) && low(card.caller.fullName ?? "").includes(surname);
      add("op112.said.name", "completeness", title, ok, {
        evidence: `${said} → в карточке: ${card.caller.fullName ? quote(card.caller.fullName) : "пусто"}`,
        expected: persona?.fullName,
      });
    } else if (e.kind === "phone") {
      const ok = digits(card.caller.provided) === digits(persona?.phone) || digits(card.caller.onSite) === digits(persona?.phone);
      add("op112.said.phone", "completeness", title, ok, {
        evidence: `${said} → предоставленный: ${card.caller.provided || "пусто"}`,
        expected: persona?.phone,
      });
    } else if (e.kind === "status") {
      add("op112.said.status", "completeness", title, card.caller.status === e.value, {
        evidence: `${said} → статус: ${card.caller.status ?? "не выбран"}`,
        expected: e.value,
      });
    }
  }

  return out;
}

// ─── Model checks ────────────────────────────────────────────────────────────

const aiSchema = z.object({
  discrepancies: z.array(z.object({ field: z.string(), said: z.string(), filled: z.string() })).default([]),
  descriptionClear: z.boolean(),
  descriptionComment: z.string().default(""),
});

export const AI_CODES = ["op112.ai.said", "op112.ai.description"] as const;

export function aiUnavailable(reason: string): CriterionResult[] {
  return [
    { code: "op112.ai.said", group: "completeness", title: "ИИ: всё сказанное заявителем попало в карточку", ok: null, evidence: reason, source: "ai" },
    { code: "op112.ai.description", group: "literacy", title: "ИИ: описание понятно следующему диспетчеру", ok: null, evidence: reason, source: "ai" },
  ];
}

export function aiEnabled(): boolean {
  return aiMode().llm !== "mock";
}

function cardSummary(card: EvalCard): string {
  const flags = Object.entries(card.flags)
    .filter(([, v]) => v)
    .map(([k]) => FLAG_TITLE[k] ?? k);
  return [
    `Заявитель: ${card.caller.fullName || "—"}, статус: ${card.caller.status || "—"}, предоставленный телефон: ${card.caller.provided || "—"}`,
    `Адрес: ${addressLine(card.address) || "—"}; район: ${card.address.district || "—"}; описательный адрес: ${card.address.descriptive || "—"}`,
    `Тип: ${card.cards.map(kindTitle).join(", ") || "—"}`,
    `Опросная карта: ${card.tags.filter((t) => t.rowId !== "_kind").map((t) => `${t.row}: ${t.text ?? t.value}`).join("; ") || "—"}`,
    `Флаги: ${flags.join(", ") || "нет"}`,
    `Описание со слов заявителя: ${card.description || "—"}`,
  ].join("\n");
}

/** Teacher corrections the two model checks are shown (src/lib/review/corrections.ts). */
export type Op112Guidance = { ctx: CorrectionContext; said: GuidanceRow[]; description: GuidanceRow[] };

/** The prompt of the model checks; pure, so it is tested without calling a model. */
export function op112AiMessages(input: EvalInput, guidance?: Op112Guidance): ChatMessage[] {
  const transcript = input.messages.map((m) => `${m.role === "trainee" ? "Оператор" : "Заявитель"}: ${m.text}`).join("\n");
  const said = guidance ? guidanceText(guidance.ctx, guidance.said) : "";
  const description = guidance ? guidanceText(guidance.ctx, guidance.description) : "";
  return [
    {
      role: "system",
      content: [
        "Ты — наставник, который разбирает работу оператора службы 112 на учебном тренажёре.",
        "Даны расшифровка разговора с заявителем и карточка происшествия, которую оператор заполнил.",
        "1) Найди расхождения «сказал ↔ заполнил»: заявитель ясно сообщил сведение (адрес, пострадавшие, газ, этажность, доступ, угроза, имя, телефон, что произошло), а в карточке его нет или записано иначе. Сведения, которых заявитель не говорил, не считай. Пересказ своими словами — не ошибка.",
        "2) Оцени описание со слов заявителя: поймёт ли следующий диспетчер, что случилось, где и есть ли пострадавшие.",
        'Верни JSON: {"discrepancies":[{"field":"поле карточки","said":"точная цитата заявителя","filled":"что в карточке"}],"descriptionClear":true|false,"descriptionComment":"одно предложение"}',
        ...(said ? ["", "К пункту 1 (расхождения «сказал ↔ заполнил»):", said] : []),
        ...(description ? ["", "К пункту 2 (описание):", description] : []),
      ].join("\n"),
    },
    { role: "user", content: `Разговор:\n${transcript || "(пусто)"}\n\nКарточка:\n${cardSummary(input.card)}` },
  ];
}

/** Transcript vs card by the model. Returns «не применимо» when no model is configured or it fails. */
export async function evaluateOp112Ai(input: EvalInput, guidance?: Op112Guidance): Promise<CriterionResult[]> {
  if (!aiEnabled()) return aiUnavailable("ИИ-проверка не выполнялась: модель не настроена");
  if (input.card.empty) return [];
  try {
    const res = await chatJson(op112AiMessages(input, guidance), aiSchema, { temperature: 0, maxTokens: 700 });
    const list = res.discrepancies.slice(0, 6);
    return [
      {
        code: "op112.ai.said",
        group: "completeness",
        title: "ИИ: всё сказанное заявителем попало в карточку",
        ok: list.length === 0,
        evidence: list.length
          ? list.map((d) => `${d.field}: заявитель ${quote(d.said, 100)} → в карточке ${quote(d.filled || "пусто", 60)}`).join("; ")
          : "Расхождений не найдено",
        source: "ai",
        learned: guidance?.said.map((g) => g.id) ?? [],
      },
      {
        code: "op112.ai.description",
        group: "literacy",
        title: "ИИ: описание понятно следующему диспетчеру",
        ok: res.descriptionClear,
        evidence: res.descriptionComment || undefined,
        source: "ai",
        learned: guidance?.description.map((g) => g.id) ?? [],
      },
    ];
  } catch (err) {
    return aiUnavailable(`ИИ-проверка не удалась: ${err instanceof Error ? err.message.slice(0, 120) : "ошибка"}`);
  }
}
