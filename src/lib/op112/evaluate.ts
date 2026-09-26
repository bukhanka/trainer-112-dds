/**
 * Review of a 112 operator's card: the card against the scenario's reference answer and — the main
 * part — against what the caller actually said in the conversation («сказал ↔ заполнил»).
 *
 * Rules always run and are deterministic. With a language model configured, two extra checks read
 * the transcript (missed statements, clarity of the description); without a model they stay
 * «не применимо» (ok = null) and do not affect the score.
 */
import { z } from "zod";
import { aiMode, chatJson } from "@/lib/ai/provider";
import { CALLER_STATUSES, type IncidentAddress, type IncidentCaller, type IncidentFlags } from "@/lib/incident/types";
import type { CriterionResult, WeightGroup } from "@/lib/scoring/score";
import { questionCard, whatHappened } from "./catalog";
import { askedAbout, factCards, low, normalizeQuestion } from "./facts";
import { compareStreets, normHouse, addressLine } from "./gazetteer";
import type { Persona } from "./caller";
import { routeServices, type RoutingInput, type ServiceLite } from "./routing";
import type { CallLine, CardAnswers, FactCard, ScenarioTruth, StoredTag } from "./types";

export type EvalCard = {
  caller: IncidentCaller;
  address: IncidentAddress;
  flags: IncidentFlags;
  tags: StoredTag[];
  cards: string[];
  description: string;
  openedAt: Date | null;
  savedAt: Date | null;
  empty?: "noContact" | "dropped";
};

export type EvalInput = {
  card: EvalCard;
  serviceIds: number[];
  persona: Persona | null;
  truth: NormalizedTruth | null;
  messages: CallLine[];
  typingSec: number;
  catalog: ServiceLite[];
};

// ─── Reference answer ────────────────────────────────────────────────────────

const flagsSchema = z.record(z.string(), z.boolean()).catch({});
const truthSchema = z.object({
  cards: z.array(z.string()).catch([]),
  typeCodes: z.array(z.number()).catch([]),
  tags: z.array(z.object({ card: z.string().optional(), row: z.string(), value: z.string() })).catch([]),
  flags: flagsSchema,
  address: z.record(z.string(), z.string()).catch({}),
  services: z.array(z.union([z.number(), z.string()])).catch([]),
  requiredQuestions: z
    .array(z.union([z.string(), z.object({ text: z.string(), topic: z.string().optional(), keywords: z.array(z.string()).optional() })]))
    .catch([]),
  callerStatus: z.enum(CALLER_STATUSES).optional().catch(undefined),
  descriptionKeywords: z.array(z.string()).catch([]),
  emptyCall: z.enum(["noContact", "dropped"]).optional().catch(undefined),
});

export type NormalizedTruth = ScenarioTruth & { emptyCall?: "noContact" | "dropped" };

/** Scenario.truth from any editor → the shape the checks use; unknown or broken parts become empty. */
export function normalizeTruth(raw: unknown): NormalizedTruth | null {
  if (!raw || typeof raw !== "object") return null;
  const t = truthSchema.parse(raw);
  return {
    ...t,
    flags: t.flags as IncidentFlags,
    address: t.address as IncidentAddress,
    requiredQuestions: t.requiredQuestions.map((q) => normalizeQuestion(q as never)),
  };
}

/** Reference tags → questionnaire answers, so the routing engine can compute the reference services. */
export function truthRoutingInput(truth: ScenarioTruth): RoutingInput {
  const answers: Record<string, CardAnswers> = {};
  for (const tag of truth.tags) {
    const cardKey = tag.card ?? truth.cards[0];
    if (!cardKey) continue;
    const row = questionCard(cardKey).rows.find((r) => r.label === tag.row);
    if (!row) continue;
    const a = (answers[cardKey] ??= {});
    (a[row.id] ??= []).push(tag.value.split("|")[0]);
  }
  return { cards: truth.cards, answers, flags: truth.flags, address: truth.address };
}

export function expectedServiceIds(truth: ScenarioTruth, catalog: ServiceLite[]): number[] {
  if (truth.services.length) {
    return truth.services
      .map((s) => (typeof s === "number" ? s : catalog.find((c) => c.shortName === s)?.id))
      .filter((id): id is number => typeof id === "number");
  }
  return routeServices(truthRoutingInput(truth), catalog).map((r) => r.serviceId);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const yesNo = (v: boolean | undefined) => (v ? "да" : "нет");
const quote = (s: string, max = 140) => `«${s.length > max ? `${s.slice(0, max - 1)}…` : s}»`;
const digits = (s: string | undefined) => (s ?? "").replace(/\D/g, "").slice(-10);
const same = (a: string | undefined, b: string | undefined) => low(a ?? "").trim() === low(b ?? "").trim();
const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

const FLAG_TITLE: Record<string, string> = {
  victims: "Пострадавшие",
  refusedAmbulance: "Нет на месте / Отказ от скорой",
  noAccess: "Нет доступа / Заблокированные",
  threat: "Угроза людям",
  gas: "Газификация",
  offense: "Правонарушение",
  med: "Медицинская помощь",
  evac: "Эвакуация",
  traffic: "Перекрытие движения",
};

function tagMatches(card: EvalCard, row: string, value: string): boolean {
  const options = value.split("|").map((v) => low(v).trim());
  return card.tags.some((t) => {
    if (t.row !== row) return false;
    const v = low(t.value).trim();
    return options.some((o) => v === o || (o.length >= 2 && /^\d+$/.test(o) ? v.replace(/\D/g, "") === o : v.includes(o)));
  });
}

function filledTag(card: EvalCard, row: string): string {
  return card.tags
    .filter((t) => t.row === row)
    .map((t) => t.value)
    .join(", ");
}

/** Caller lines where a fact was said, earliest first. */
function whereSaid(messages: CallLine[], key: string): CallLine | undefined {
  return messages.find((m) => m.role === "counterpart" && m.revealed?.includes(key));
}

function descriptionHas(description: string, keywords: string[]): string[] {
  const d = low(description);
  return keywords.filter((k) => !new RegExp(k, "i").test(d));
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
    const line = whereSaid(messages, f.key);
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
      const cmp = compareStreets(f.street, t.street);
      add("op112.address.street", "address", "Улица совпадает с местом происшествия", cmp === "same", {
        critical: cmp === "lookalike",
        evidence: [
          cmp === "empty" ? "Улица не заполнена" : `В карточке: ${quote(f.street ?? "")}`,
          cmp === "lookalike" ? "Похожее название, но это другая улица — бригада уедет не туда" : "",
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
      add("op112.address.district", "address", "Район определён верно", same(f.district?.replace(/ё/g, "е"), t.district.replace(/ё/g, "е")), {
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

  // Incident type, tags, flags.
  if (truth?.cards.length) {
    const missing = truth.cards.filter((c) => !card.cards.includes(c));
    const chip = (k: string) => whatHappened(k)?.chip ?? k;
    add("op112.type", "services", "Тип происшествия («что случилось»)", missing.length === 0, {
      evidence: card.cards.length ? `Выбрано: ${card.cards.map(chip).join(", ")}` : "Тип не выбран",
      expected: truth.cards.map(chip).join(", "),
    });
  }
  const saidRows = new Set(
    [...revealed.values()].filter((r) => r.fact.expect?.kind === "tag").map((r) => (r.fact.expect as { row: string }).row),
  );
  const saidFlags = new Set(
    [...revealed.values()].filter((r) => r.fact.expect?.kind === "flag").map((r) => (r.fact.expect as { flag: string }).flag),
  );
  if (truth?.tags.length) {
    const checked = truth.tags.filter((t) => !saidRows.has(t.row));
    if (checked.length) {
      const missing = checked.filter((t) => !tagMatches(card, t.row, t.value));
      add("op112.tags", "services", "Признаки в опросной карте", missing.length === 0, {
        evidence: missing.length
          ? `Не выбрано: ${missing.map((m) => `«${m.row}: ${m.value.split("|")[0]}»${filledTag(card, m.row) ? ` (выбрано «${filledTag(card, m.row)}»)` : ""}`).join("; ")}`
          : "Все признаки выбраны",
      });
    }
  }
  for (const [key, value] of Object.entries(truth?.flags ?? {})) {
    if (typeof value !== "boolean" || saidFlags.has(key)) continue;
    const filled = Boolean(card.flags[key as keyof IncidentFlags]);
    add(`op112.flag.${key}`, "services", `Флаг «${FLAG_TITLE[key] ?? key}»`, filled === value, {
      evidence: `В карточке: ${yesNo(filled)}`,
      expected: yesNo(value),
    });
  }

  // Services against the reference list.
  if (truth) {
    const expected = expectedServiceIds(truth, input.catalog);
    const name = (id: number) => input.catalog.find((c) => c.id === id)?.shortName ?? `#${id}`;
    const missing = expected.filter((id) => !input.serviceIds.includes(id));
    const extra = input.serviceIds.filter((id) => !expected.includes(id));
    add("op112.services.missing", "services", "Оповещены все нужные службы", expected.length ? missing.length === 0 : null, {
      evidence: missing.length ? `Не хватает: ${missing.map(name).join(", ")}` : "Все нужные службы в карточке",
      expected: expected.map(name).join(", "),
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
    const topic = q.topic ?? "other";
    const asked = askedAbout(topic, operatorLines, q.keywords);
    const line = asked ? operatorLines.find((l) => askedAbout(topic, [l], q.keywords)) : undefined;
    add(`op112.question.${i + 1}`, "completeness", `Задан вопрос: ${q.text}`, asked, {
      evidence: line ? `Оператор: ${quote(line)}` : "Вопрос не прозвучал",
    });
  });

  // The first 100 characters go to service 103: the gist, and victims if any.
  const first = card.description.trim().slice(0, 100);
  const need = [...(truth?.descriptionKeywords ?? [])];
  if (card.flags.victims || truth?.flags.victims) need.push("пострадав|сознан|травм|ранен|плохо|больн");
  if (need.length) {
    const miss = descriptionHas(first, need);
    add("op112.description.first100", "literacy", "Суть и пострадавшие — в первых 100 символах описания", first ? miss.length === 0 : false, {
      evidence: first ? `В 103 уйдёт: ${quote(first, 110)}` : "Описание пустое",
      expected: miss.length ? `Добавить в начало: ${miss.map((m) => m.split("|")[0]).join(", ")}` : undefined,
    });
  }

  // «Сказал ↔ заполнил»: every fact the caller said must be in the card.
  for (const { fact, line } of revealed.values()) {
    const said = `Заявитель: ${quote(line.text)}`;
    const e = fact.expect;
    if (!e || e.kind === "address") continue;
    const title = `Сказал ↔ заполнил: ${fact.label}`;
    if (e.kind === "flag") {
      const filled = Boolean(card.flags[e.flag]);
      add(`op112.said.${fact.key}`, "services", title, filled === e.value, {
        evidence: `${said} → в карточке «${FLAG_TITLE[e.flag] ?? e.flag}»: ${yesNo(filled)}`,
        expected: `«${FLAG_TITLE[e.flag] ?? e.flag}»: ${yesNo(e.value)}`,
      });
    } else if (e.kind === "tag") {
      const ok = tagMatches(card, e.row, e.value);
      add(`op112.said.${fact.key}`, "services", title, ok, {
        evidence: `${said} → «${e.row}»: ${filledTag(card, e.row) || "не заполнено"}`,
        expected: `«${e.row}»: ${e.value.split("|")[0]}`,
      });
    } else if (e.kind === "description") {
      const miss = descriptionHas(card.description, e.keywords);
      add(`op112.said.${fact.key}`, "literacy", title, miss.length === 0, {
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
  discrepancies: z
    .array(z.object({ field: z.string(), said: z.string(), filled: z.string(), critical: z.boolean().optional() }))
    .default([]),
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
    `Тип: ${card.cards.map((c) => whatHappened(c)?.chip ?? c).join(", ") || "—"}`,
    `Признаки: ${card.tags.filter((t) => t.rowId !== "_type").map((t) => `${t.row}: ${t.value}`).join("; ") || "—"}`,
    `Флаги: ${flags.join(", ") || "нет"}`,
    `Описание со слов заявителя: ${card.description || "—"}`,
  ].join("\n");
}

/** Transcript vs card by the model. Returns «не применимо» when no model is configured or it fails. */
export async function evaluateOp112Ai(input: EvalInput): Promise<CriterionResult[]> {
  if (!aiEnabled()) return aiUnavailable("ИИ-проверка не выполнялась: модель не настроена");
  if (input.card.empty) return [];
  const transcript = input.messages.map((m) => `${m.role === "trainee" ? "Оператор" : "Заявитель"}: ${m.text}`).join("\n");
  try {
    const res = await chatJson(
      [
        {
          role: "system",
          content: [
            "Ты — наставник, который разбирает работу оператора службы 112 на учебном тренажёре.",
            "Даны расшифровка разговора с заявителем и карточка происшествия, которую оператор заполнил.",
            "1) Найди расхождения «сказал ↔ заполнил»: заявитель ясно сообщил сведение (адрес, пострадавшие, газ, этажность, доступ, угроза, имя, телефон, что произошло), а в карточке его нет или записано иначе. Сведения, которых заявитель не говорил, не считай. Пересказ своими словами — не ошибка.",
            "2) Оцени описание со слов заявителя: поймёт ли следующий диспетчер, что случилось, где и есть ли пострадавшие.",
            'Верни JSON: {"discrepancies":[{"field":"поле карточки","said":"точная цитата заявителя","filled":"что в карточке","critical":true|false}],"descriptionClear":true|false,"descriptionComment":"одно предложение"}',
          ].join("\n"),
        },
        { role: "user", content: `Разговор:\n${transcript || "(пусто)"}\n\nКарточка:\n${cardSummary(input.card)}` },
      ],
      aiSchema,
      { temperature: 0, maxTokens: 700 },
    );
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
      },
      {
        code: "op112.ai.description",
        group: "literacy",
        title: "ИИ: описание понятно следующему диспетчеру",
        ok: res.descriptionClear,
        evidence: res.descriptionComment || undefined,
        source: "ai",
      },
    ];
  } catch (err) {
    return aiUnavailable(`ИИ-проверка не удалась: ${err instanceof Error ? err.message.slice(0, 120) : "ошибка"}`);
  }
}
