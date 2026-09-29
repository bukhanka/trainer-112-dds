import { describe, expect, it } from "vitest";
import { computeScore, type Weights } from "@/lib/scoring/score";
import type { Persona } from "./caller";
import { resolveCard } from "./card";
import { evaluateOp112Ai, evaluateOp112Rules, judgedByRules, nameWithoutPatronymic, normalizeTruth, op112AiMessages, referenceLeaves, streetVerdict, supportedAiDiscrepancies, type EvalInput } from "./evaluate";
import { factCards } from "./facts";
import type { ServiceLite } from "./routing";
import type { CallLine, CardAnswers } from "./types";

const CATALOG: ServiceLite[] = [
  { id: 1, shortName: "Служба 101", kind: "центральная", orderIdx: 1 },
  { id: 7, shortName: "ЦОДД", kind: "ведомственная", orderIdx: 7 },
  { id: 33, shortName: "ОАТИ", kind: "ведомственная", orderIdx: 33 },
  { id: 113, shortName: "Служба 102", kind: "центральная", orderIdx: 113 },
  { id: 60, shortName: "Поселение Дорогомилово", kind: "территориальная", orderIdx: 60 },
  { id: 156, shortName: "Поселение ЗАО", kind: "территориальная", orderIdx: 156 },
];

const WEIGHTS: Weights = { timeliness: 3, statusOrder: 2, comments: 2, address: 3, services: 3, completeness: 1, literacy: 1 };
const FLAME = "Открытое пламя / Дым";

// The reference data format (data/scenarios.json).
const persona: Persona = {
  fullName: "Сидоров Иван Сергеевич",
  role: "очевидец",
  phone: "+7 (916) 126-34-71",
  visibleAddress: "депо у Киевского вокзала",
  hiddenAddress: "МЖД Киевская 1 км, стр. 2",
  situation: "Алло, тут мусорный контейнер горит, у депо возле Киевского вокзала.",
  facts: [
    "Горит один контейнер с мусором, огонь видно, дым чёрный",
    "Пострадавших нет, рядом никого",
    "Рядом жилой дом, он газифицирован (сообщает только на вопрос)",
  ],
  temper: "calm",
  voice: "male",
};

const truthRaw = {
  kind: "101",
    typeCodes: [1010101],
    acceptableTypeCodes: [1010101, 1010102],
    finalType: "пожар: мусор",
    tags: ["на улице", "мусор", "открытое пламя"],
    flags: {},
    address: { subject: "Москва", city: "Москва", okrug: "ЗАО", district: "Дорогомилово", street: "МЖД Киевская 1 км", structure: "2" },
    services: [
      { serviceId: 1, shortName: "Служба 101", isMain: true },
      { serviceId: 7, shortName: "ЦОДД" },
      { serviceId: 33, shortName: "ОАТИ" },
      { serviceId: 60, shortName: "Поселение Дорогомилово" },
      { serviceId: 156, shortName: "Поселение ЗАО" },
    ],
    requiredQuestions: [
      "Уточнить адрес: первый ответ заявителя неполный или неточный",
      "Есть ли пострадавшие",
      "ФИО и статус заявителя, контактный телефон",
    ],
    traps: ["Ориентир «депо у вокзала» — не адрес"],
};
const truth = normalizeTruth(truthRaw, CATALOG)!;

const at = "2026-09-26T10:00:00.000Z";
const line = (role: CallLine["role"], text: string, revealed?: string[]): CallLine => ({ role, text, at, revealed });

const goodMessages: CallLine[] = [
  line("counterpart", "Алло, тут мусорный контейнер горит, у депо возле Киевского вокзала.", ["situation"]),
  line("trainee", "Назовите адрес"),
  line("counterpart", "депо у Киевского вокзала", ["address"]),
  line("trainee", "Уточните адрес, номер строения"),
  line("counterpart", "Сейчас… точнее так: МЖД Киевская 1 км, стр. 2", ["addressExact"]),
  line("trainee", "Как вас зовут?"),
  line("counterpart", "Сидоров Иван Сергеевич.", ["name"]),
  line("trainee", "Есть пострадавшие?"),
  line("counterpart", "Пострадавших нет, рядом никого", ["fact2"]),
];

type Over = {
  answers?: CardAnswers;
  top?: Partial<Record<"victims" | "noAccess" | "refusedAmbulance", boolean>>;
  street?: string;
  district?: string;
  description?: string;
  services?: number[];
  messages?: CallLine[];
  savedAfterSec?: number;
  empty?: "noContact";
};

function input(over: Over = {}): EvalInput {
  const answers = { "101": over.answers ?? { where: ["Улица"], signStreet: [FLAME], streetObject: ["Мусор"] } };
  const r = resolveCard(["101"], answers, over.top ?? {});
  const opened = new Date(at);
  return {
    card: {
      caller: { fullName: "Сидоров Иван", status: "очевидец", provided: "+7 (916) 126-34-71", aon: "+7 (916) 126-34-71" },
      address: { street: over.street ?? "МЖД Киевская 1 км", structure: "2", okrug: "ЗАО", district: over.district ?? "Дорогомилово" },
      flags: r.flags,
      tags: r.tags,
      cards: ["101"],
      typeCodes: r.typeCodes,
      description: over.description ?? "Горит мусорный контейнер у депо Киевского вокзала, пострадавших нет.",
      openedAt: opened,
      savedAt: new Date(opened.getTime() + (over.savedAfterSec ?? 50) * 1000),
      empty: over.empty,
    },
    serviceIds: over.services ?? [1, 7, 33, 60, 156],
    persona,
    truth,
    expectedServices: truth.services,
    messages: over.messages ?? goodMessages,
    typingSec: 65,
    catalog: CATALOG,
    typeNames: { 1010101: "пожар: мусор", 1010102: "пожар: мусор (задымление)" },
  };
}

const byCode = (list: ReturnType<typeof evaluateOp112Rules>, code: string) => list.find((c) => c.code === code);

describe("evaluateOp112Rules", () => {
  it("gives full marks to a card that matches the reference and the conversation", () => {
    const res = evaluateOp112Rules(input());
    expect(res.filter((c) => c.ok === false)).toEqual([]);
    expect(computeScore(res, WEIGHTS)).toBe(100);
  });

  it("marks a known look-alike street as a critical mistake and caps the score", () => {
    const base = input();
    const lookalike = normalizeTruth({ ...truthRaw, address: { street: "Дубининская ул.", house: "2", district: "Даниловский", okrug: "ЮАО" } }, CATALOG)!;
    const res = evaluateOp112Rules({
      ...base,
      truth: lookalike,
      card: { ...base.card, address: { street: "Дубнинская ул.", house: "2", district: "Даниловский", okrug: "ЮАО" } },
    });
    const street = byCode(res, "op112.address.street");
    expect(street?.ok).toBe(false);
    expect(street?.critical).toBe(true);
    expect(computeScore(res, WEIGHTS)).toBeLessThanOrEqual(40);
  });

  it("treats a typo in the street as a plain mistake", () => {
    const street = byCode(evaluateOp112Rules(input({ street: "МЖД Киевская 2 км" })), "op112.address.street");
    expect(street?.ok).toBe(false);
    expect(street?.critical).toBeFalsy();
  });

  it("does not count an unanswered «нет» row as «нет»", () => {
    const base = input();
    const t = normalizeTruth({ ...truthRaw, flags: { threat: false } }, CATALOG)!;
    const blank = byCode(evaluateOp112Rules({ ...base, truth: t }), "op112.flag.threat");
    expect(blank?.ok).toBe(false);
    const answered = input({ answers: { where: ["Улица"], signStreet: [FLAME], streetObject: ["Мусор"], threat: ["Нет"] } });
    expect(byCode(evaluateOp112Rules({ ...answered, truth: t }), "op112.flag.threat")?.ok).toBe(true);
  });

  it("matches numbers as whole numbers in the description", () => {
    const p2: Persona = { ...persona, facts: [...persona.facts, "Водителю 54 года, в сознании"] };
    const age = factCards(p2).find((f) => f.topic === "age")!;
    const messages = [...goodMessages, line("trainee", "Сколько лет водителю?"), line("counterpart", age.text, [age.key])];
    const res = evaluateOp112Rules({ ...input({ messages, description: "Горит мусорный контейнер, рядом а/м Р254ТС99, пострадавших нет." }), persona: p2 });
    expect(byCode(res, `op112.said.${age.key}`)?.ok).toBe(false);
  });

  it("quotes the caller when a said fact is missing from the card", () => {
    const gasFact = factCards(persona).find((f) => f.topic === "gas")!;
    const messages = [...goodMessages, line("trainee", "Газ в доме есть?"), line("counterpart", gasFact.text, [gasFact.key])];
    const res = evaluateOp112Rules(input({ messages }));
    const gas = byCode(res, `op112.said.${gasFact.key}`);
    expect(gas?.ok).toBe(false);
    expect(gas?.evidence).toContain("«Рядом жилой дом, он газифицирован»");
    expect(gas?.expected).toContain("да");
  });

  it("does not blame the operator for a fact the caller never said", () => {
    const res = evaluateOp112Rules(input());
    expect(res.some((c) => c.code.startsWith("op112.said.fact3"))).toBe(false);
  });

  it("checks the classification against the reference leaves", () => {
    const res = evaluateOp112Rules(input({ answers: { where: ["Улица"], signStreet: ["Запах гари"] } }));
    const cls = byCode(res, "op112.class");
    expect(cls?.ok).toBe(false);
    expect(cls?.expected).toBe("пожар: мусор");
  });

  it("finds required questions in the operator's own words", () => {
    const res = evaluateOp112Rules(input());
    expect(byCode(res, "op112.question.1")?.evidence).toContain("Уточните адрес");
    expect(byCode(res, "op112.question.2")?.ok).toBe(true);
    expect(byCode(res, "op112.question.3")?.ok).toBe(true);
    const silent = evaluateOp112Rules(input({ messages: goodMessages.filter((m) => m.role === "counterpart") }));
    expect(byCode(silent, "op112.question.2")?.ok).toBe(false);
  });

  it("lists missing and extra services", () => {
    const res = evaluateOp112Rules(input({ services: [1, 7, 60, 156, 113] }));
    expect(byCode(res, "op112.services.missing")?.evidence).toContain("ОАТИ");
    expect(byCode(res, "op112.services.extra")?.evidence).toContain("Служба 102");
  });

  it("fails the typing time after the norm", () => {
    expect(byCode(evaluateOp112Rules(input({ savedAfterSec: 95 })), "op112.typing_time")?.ok).toBe(false);
  });

  it("names the time and the norm and scores a late card by how late it is", () => {
    const quick = byCode(evaluateOp112Rules(input({ savedAfterSec: 53 })), "op112.typing_time");
    expect(quick).toMatchObject({ ok: true, title: "Карточка сохранена за 0:53 при нормативе 1:05", evidence: "В нормативе, таймер не покраснел: запас 0:12" });
    const slow = byCode(evaluateOp112Rules(input({ savedAfterSec: 195 })), "op112.typing_time");
    expect(slow).toMatchObject({
      ok: false,
      title: "Карточка сохранена за 3:15 при нормативе 1:05",
      evidence: "Дольше норматива на 2:10, таймер покраснел",
      expected: "сохранить не позже 1:05, пока таймер не покраснел",
      timing: { sec: 195, normSec: 65 },
    });
    // Jury's case: a right card at 3:15 was scored like one at 1:06. Now 1:06 loses almost nothing, 3:15 — the time part.
    const score = (sec: number) => computeScore(evaluateOp112Rules(input({ savedAfterSec: sec })), WEIGHTS)!;
    expect(score(66)).toBeGreaterThan(score(98));
    expect(score(98)).toBeGreaterThan(score(195));
    expect(score(66)).toBeGreaterThanOrEqual(99);
    expect(score(195)).toBe(score(130));
  });

  it("wants the gist and victims in the first 100 characters", () => {
    const description = `${"Звонит очевидец, говорит что у депо Киевского вокзала что-то случилось, просит приехать поскорее."} Горит мусор, есть пострадавший.`;
    const res = evaluateOp112Rules(input({ description, top: { victims: true } }));
    const first = byCode(res, "op112.description.first100");
    expect(first?.ok).toBe(false);
    expect(first?.expected).toContain("гор");
  });

  it("flags a wrong district, which loses the territorial services", () => {
    expect(byCode(evaluateOp112Rules(input({ district: "Арбат" })), "op112.address.district")?.ok).toBe(false);
  });

  it("treats an empty card for a live caller as a critical mistake", () => {
    const res = evaluateOp112Rules(input({ empty: "noContact" }));
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ code: "op112.empty", ok: false, critical: true });
  });
});

describe("clarifying the place counts only after the caller's first answer", () => {
  // Б4-1: the caller does not know the house number, the exact place comes on a clarifying question.
  const grina: Persona = {
    ...persona,
    visibleAddress: "Москва, ул. Грина, номер дома не знает, в этом доме библиотека № 193",
    hiddenAddress: "ул. Грина, дом 11",
    situation: "Пожар! На улице Грина горит балкон на тринадцатом этаже.",
  };
  const t4 = normalizeTruth({ ...truthRaw, requiredQuestions: ["Уточнить адрес: первый ответ заявителя неполный или неточный", "Номер дома (ориентир — библиотека № 193)", "Газифицирован ли дом"] }, CATALOG)!;
  const hello = line("counterpart", "Алло, здравствуйте…", []);
  const incomplete = line("counterpart", "Пожар! На улице Грина горит балкон. Москва, улица Грина, номер дома не знаю, в этом доме библиотека номер 193.", ["situation", "address"]);
  const exact = line("counterpart", "Сейчас… точнее так: улица Грина, дом 11.", ["addressExact"]);
  const judge = (messages: CallLine[]) => evaluateOp112Rules({ ...input({ messages }), persona: grina, truth: t4 });

  it("the jury's case: «Назовите адрес.» before the caller answered is not a clarification", () => {
    const res = judge([hello, line("trainee", "Служба 112, что у вас случилось? Назовите адрес."), incomplete, line("trainee", "Есть пострадавшие?"), line("counterpart", "Не знаю, не вижу.", [])]);
    const q = byCode(res, "op112.question.1")!;
    expect(q.ok).toBe(false);
    expect(q.evidence).toContain("уточняющего вопроса после этого не было");
    expect(q.evidence).toContain("прозвучал до ответа");
    expect(q.expected).toMatch(/номер дома/);
    // The neighbouring question about the house number is not asked by «Назовите адрес» either.
    expect(byCode(res, "op112.question.2")?.ok).toBe(false);
  });

  it("a question about the place after the incomplete answer is the clarification, quoted with that answer", () => {
    const res = judge([hello, line("trainee", "Служба 112, что случилось? Назовите адрес."), incomplete, line("trainee", "Какой номер дома? Что рядом?"), exact]);
    const q = byCode(res, "op112.question.1")!;
    expect(q.ok).toBe(true);
    expect(q.evidence).toContain("«Какой номер дома? Что рядом?»");
    expect(q.evidence).toContain("после ответа заявителя «Пожар!");
    expect(byCode(res, "op112.question.2")?.ok).toBe(true);
  });

  it("a line with «уточните» about something else does not clarify the place", () => {
    const res = judge([hello, line("trainee", "Назовите адрес"), incomplete, line("trainee", "Уточните, есть ли пострадавшие? Какой номер телефона?")]);
    expect(byCode(res, "op112.question.1")?.ok).toBe(false);
    expect(byCode(res, "op112.question.2")?.ok).toBe(false);
  });

  it("nothing to clarify when the first answer already was the exact place: «не применимо», not a pass", () => {
    const direct = line("counterpart", "Пожар! Горит балкон. Улица Грина, дом 11.", ["situation", "addressExact"]);
    const q = byCode(judge([hello, line("trainee", "Служба 112, назовите точный адрес, номер дома"), direct]), "op112.question.1")!;
    expect(q.ok).toBeNull();
    expect(q.evidence).toContain("Уточнять не пришлось");
  });

  it("no question about the place at all is a mistake", () => {
    const q = byCode(judge([hello, line("trainee", "Что случилось?"), line("counterpart", "Горит балкон на тринадцатом этаже!", ["situation"])]), "op112.question.1")!;
    expect(q).toMatchObject({ ok: false, evidence: "Вопросов об адресе не было" });
  });
});

describe("reference answer", () => {
  it("reads the data format: services as objects, questions as text, gist from tags", () => {
    expect(truth.services).toEqual([1, 7, 33, 60, 156]);
    expect(truth.requiredQuestions[0].topic).toBe("addressExact");
    expect(truth.descriptionKeywords.join(" ")).toContain("мусор");
  });

  it("takes the plates of the accepted leaf the trainee chose, the scenario's list otherwise", () => {
    const t = { typeCodes: [10], acceptableTypeCodes: [10, 11, 12] };
    expect(referenceLeaves(t, [10])).toEqual({ codes: [10], alternative: false });
    expect(referenceLeaves(t, [11, 99])).toEqual({ codes: [11], alternative: true });
    expect(referenceLeaves(t, [99])).toEqual({ codes: [10], alternative: false });
    expect(referenceLeaves(t, [])).toEqual({ codes: [10], alternative: false });
  });

  it("calls the tunnel flag by its name on the card", () => {
    const res = evaluateOp112Rules({ ...input(), truth: { ...truth, flags: { tunnel: true } } });
    expect(byCode(res, "op112.flag.tunnel")?.title).toBe("Флаг «Тоннель»");
  });

  it("names the accepted leaf the reference plates follow", () => {
    const res = evaluateOp112Rules({ ...input(), expectedServicesBy: "задымление: мусор" });
    expect(byCode(res, "op112.services.missing")?.expected).toContain("по выбранному допустимому листу «задымление: мусор»");
  });

  it("returns null without a reference and survives broken parts", () => {
    expect(normalizeTruth(null)).toBeNull();
    expect(normalizeTruth({ flags: "oops", services: "x" })?.services).toEqual([]);
  });

  it("knows look-alike streets from the reference list", () => {
    expect(streetVerdict("Дубнинская ул.", "Дубининская ул.")).toBe("lookalike");
    expect(streetVerdict("улица Грина", "ул. Грина")).toBe("same");
  });
});

describe("«сказал ↔ заполнил»: the verdict and its evidence agree", () => {
  const p2: Persona = { ...persona, facts: [...persona.facts, "Дом 17-этажный, я на седьмом этаже"] };
  const floors = factCards(p2).find((c) => c.expect?.kind === "tag" && c.expect.row === "Этажность здания")!;
  const messages = [
    ...goodMessages,
    line("trainee", "На каком вы этаже?"),
    line("counterpart", "На седьмом этаже дым идёт из клапана мусоропровода.", [floors.key]),
    line("trainee", "Сколько этажей в доме?"),
    line("counterpart", "Дом семнадцатиэтажный.", [floors.key]),
  ];
  const check = (description: string) => evaluateOp112Rules({ ...input({ messages, description }), persona: p2 }).find((c) => c.code === `op112.said.${floors.key}`)!;

  it("quotes the line with the value and does not take a house number for the floors", () => {
    const c = check("Горит мусорный контейнер у дома 17, пострадавших нет.");
    expect(c.ok).toBe(false);
    expect(c.evidence).toContain("«Дом семнадцатиэтажный.»");
    expect(c.evidence).toContain("«Этажность здания»: не заполнено, в описании нет");
  });

  it("quotes the description by whole words", () => {
    const c = check("Задымление в подъезде на седьмом этаже, дом 17 этажей, дым идёт из клапана мусоропровода, пострадавших нет.");
    expect(c.ok).toBe(true);
    expect(c.evidence).toContain("→ в описании: «…подъезде на седьмом этаже, дом 17 этажей, дым идёт из клапана…»");
  });

  it("says «в описании» when the value is written there", () => {
    const c = check("Задымление мусоропровода, дом 17 этажей, пострадавших нет.");
    expect(c.ok).toBe(true);
    expect(c.evidence).toContain("→ в описании: «");
    expect(c.evidence).not.toContain("не заполнено");
  });
});

describe("the model does not judge what the rules compare with the reference", () => {
  const rules = evaluateOp112Rules(input());

  it("leaves the address to the rules: the AI caller's slip is not held against the student", () => {
    // The caller said «корпус 1, 2», the card has «к. 1»; the address rule by the reference is the one that counts.
    expect(judgedByRules("Адрес", rules)).toBe(true);
    expect(judgedByRules("Номер дома", rules)).toBe(true);
    // Without a reference address there is no rule, and the model may look at it.
    expect(judgedByRules("Адрес", rules.filter((c) => !c.code.startsWith("op112.address.")))).toBe(false);
  });

  it("leaves the caller's name and the facts the rules compare, keeps the rest for the model", () => {
    expect(judgedByRules("Заявитель", rules)).toBe(true);
    expect(judgedByRules("Пострадавшие", rules)).toBe(true);
    expect(judgedByRules("Домашнее животное", rules)).toBe(false);
  });

  it("does not treat a merely filled name or phone as a checked value", () => {
    const onlyPresence = rules.filter((c) => !["op112.said.name", "op112.said.phone"].includes(c.code));
    expect(judgedByRules("Заявитель", onlyPresence)).toBe(false);
    expect(judgedByRules("Телефон", onlyPresence)).toBe(false);
  });

  it("tells the model what the rules have already compared", () => {
    const [system] = op112AiMessages(input(), undefined, rules);
    expect(system.content).toContain("Адрес не оценивай");
    expect(system.content).toContain("Это уже сверено правилами с эталоном задания");
    expect(system.content).toContain("«Улица совпадает с местом происшествия»");
  });
});

describe("evaluateOp112Ai", () => {
  it("does not count a name without the patronymic as a discrepancy", () => {
    expect(nameWithoutPatronymic({ field: "Заявитель", said: "Соколова Вера Ивановна", filled: "Соколова Вера" })).toBe(true);
    expect(nameWithoutPatronymic({ field: "ФИО", said: "Соколова Вера Ивановна", filled: "Соколов" })).toBe(false);
    expect(nameWithoutPatronymic({ field: "ФИО", said: "Соколова Вера Ивановна", filled: "Соколова Ивановна" })).toBe(false);
    expect(nameWithoutPatronymic({ field: "Адрес", said: "улица Твардовского 2", filled: "Твардовского 2" })).toBe(false);
  });

  it("leaves the model checks «не применимо» when no model is configured", async () => {
    const prev = process.env.LLM_BASE_URL;
    delete process.env.LLM_BASE_URL;
    const res = await evaluateOp112Ai(input());
    process.env.LLM_BASE_URL = prev;
    expect(res.map((c) => c.ok)).toEqual([null, null]);
  });

  it("shows the model the teachers' corrections of each check (prompt only, no model call)", () => {
    const ctx = { scenarioId: "s1", typeCode: 1010101, typeGroupId: 1, category: "пожар" };
    const row = (id: string, code: string, comment: string) => ({
      ...ctx,
      id,
      code,
      title: code,
      source: "rule",
      typeName: "пожар: мусор",
      draftOk: false,
      draftEvidence: "Заявитель: «газа нет» → в карточке: не отмечено",
      teacherOk: true,
      comment,
      createdAt: new Date("2026-09-25T09:00:00Z"),
    });
    const [system, user] = op112AiMessages(input(), {
      ctx,
      said: [row("c1", "op112.said.gas", "Газ записан в описании — так можно")],
      description: [row("c2", "op112.ai.description", "Короткое описание без подробностей допустимо")],
    });
    expect(system.content).toContain("К пункту 1 (расхождения «сказал ↔ заполнил»):");
    expect(system.content).toContain("«Газ записан в описании — так можно»");
    expect(system.content).toContain("К пункту 2 (описание):");
    expect(user.content).toContain("Разговор:");
    expect(op112AiMessages(input())[0].content).not.toContain("Правки преподавателей");
  });
});

describe("untrusted caller and model evidence", () => {
  it("compares both surname and given name while leaving patronymic optional", () => {
    const base = input();
    const wrong = evaluateOp112Rules({
      ...base,
      card: { ...base.card, caller: { ...base.card.caller, fullName: "Сидоров Пётр" } },
    });
    expect(byCode(wrong, "op112.said.name")).toMatchObject({ ok: false, expected: "Сидоров Иван" });
    expect(byCode(evaluateOp112Rules(base), "op112.said.name")?.ok).toBe(true);
  });

  it("does not penalize a trainee for a caller label that contradicts the spoken address or phone", () => {
    const base = input();
    const messages = [
      line("counterpart", persona.situation, ["situation"]),
      line("trainee", "Уточните адрес и ваш телефон"),
      line("counterpart", "Точный адрес: МЖД Киевская 2 км, строение 5", ["addressExact"]),
      line("counterpart", "Мой телефон 8 999 999 99 99", ["phone"]),
    ];
    const res = evaluateOp112Rules({ ...base, messages });
    expect(byCode(res, "op112.address.street")?.ok).toBeNull();
    expect(byCode(res, "op112.address.house")?.ok).toBeNull();
    expect(byCode(res, "op112.field.phone")?.ok).toBeNull();
    expect(byCode(res, "op112.said.phone")).toBeUndefined();
  });

  it("still checks the address after the caller later gives a correct precise address", () => {
    const base = input();
    const messages = [
      line("counterpart", "Депо у другого вокзала", ["address"]),
      line("trainee", "Уточните точный адрес"),
      line("counterpart", "МЖД Киевская 1 км, строение 2", ["addressExact"]),
    ];
    const res = evaluateOp112Rules({ ...base, messages });
    expect(byCode(res, "op112.address.street")?.ok).toBe(true);
    expect(byCode(res, "op112.address.house")?.ok).toBe(true);
  });

  it("rejects invented quotes, operator quotes and invented card values before an AI penalty", () => {
    const base = input({ messages: [line("trainee", "Пострадавших трое"), line("counterpart", "Пострадавших нет, рядом никого")] });
    const card = { ...base.card, caller: { ...base.card.caller, fullName: "" } };
    const data = { ...base, card };
    const model = [
      { field: "ФИО заявителя", said: "Сидоров Иван Сергеевич", filled: "пусто" }, // invented caller quote
      { field: "Пострадавшие", said: "Пострадавших трое", filled: "нет" }, // operator spoke it
      { field: "ФИО заявителя", said: "Пострадавших нет, рядом никого", filled: "пусто" }, // wrong ticket fact
      { field: "ФИО заявителя", said: "Пострадавших нет, рядом никого", filled: "Сидоров Иван" }, // invented filled value
    ];
    expect(supportedAiDiscrepancies(data, [], model)).toEqual([]);
  });

  it("does not penalize a nonempty description for a model's semantic guess", () => {
    const base = input({ messages: [line("counterpart", "Пострадавших нет, рядом никого")] });
    const discrepancy = { field: "Описание", said: "Пострадавших нет, рядом никого", filled: base.card.description };
    expect(supportedAiDiscrepancies(base, [], [discrepancy])).toEqual([]);
  });

  it("accepts a real, checkable discrepancy that the rules have not covered", () => {
    const base = input({ messages: [line("counterpart", "Меня зовут Сидоров Иван Сергеевич")] });
    const data = { ...base, card: { ...base.card, caller: { ...base.card.caller, fullName: "" } } };
    const discrepancy = { field: "ФИО заявителя", said: "Сидоров Иван Сергеевич", filled: "пусто" };
    expect(supportedAiDiscrepancies(data, [], [discrepancy])).toEqual([discrepancy]);
  });
});

describe("a silent line and a call that breaks off («нет контакта», «срыв звонка»)", () => {
  const silentPersona: Persona = {
    fullName: "Абонент не ответил",
    role: "не установлен",
    visibleAddress: "адрес не назван",
    situation: "В трубке тишина.",
    facts: ["На вызов никто не отвечает"],
    line: "silent",
    dropAfter: 4,
  };
  const emptyTruth = (emptyCall: "noContact" | "dropped") =>
    normalizeTruth({ typeCodes: [], acceptableTypeCodes: [], flags: {}, address: {}, services: [], requiredQuestions: [], traps: [], emptyCall }, CATALOG)!;
  const silence = line("counterpart", "…тишина, в трубке только шум…");
  silence.noise = "silence";
  const hangup: CallLine = { role: "counterpart", text: "…короткие гудки: связь прервалась…", at, revealed: [], noise: "hangup" };

  function emptyInput(over: { pressed?: "noContact" | "dropped"; expected?: "noContact" | "dropped"; messages?: CallLine[]; sec?: number; persona?: Persona }): EvalInput {
    const base = input();
    const opened = new Date(at);
    return {
      ...base,
      card: { ...base.card, empty: over.pressed, savedAt: new Date(opened.getTime() + (over.sec ?? 20) * 1000) },
      persona: over.persona ?? silentPersona,
      truth: emptyTruth(over.expected ?? "noContact"),
      expectedServices: [],
      messages: over.messages ?? [silence, line("trainee", "Служба 112, говорите, вас не слышно"), silence],
    };
  }

  it("a silent line closed with «нет контакта» after hailing the caller, in time: nothing to fix", () => {
    const res = evaluateOp112Rules(emptyInput({ pressed: "noContact" }));
    expect(res.map((c) => c.code)).toEqual(["op112.empty.button", "op112.empty.hail", "op112.typing_time"]);
    expect(res.filter((c) => c.ok === false)).toEqual([]);
    expect(byCode(res, "op112.empty.button")?.evidence).toContain("тишина");
    expect(computeScore(res, WEIGHTS)).toBe(100);
  });

  it("the other button is a plain mistake; no word into the handset and a slow decision are caught", () => {
    const wrong = byCode(evaluateOp112Rules(emptyInput({ pressed: "dropped" })), "op112.empty.button");
    expect(wrong).toMatchObject({ ok: false });
    expect(wrong?.critical).toBeFalsy();
    expect(wrong?.expected).toContain("нет контакта");
    const mute = evaluateOp112Rules(emptyInput({ pressed: "noContact", messages: [silence] }));
    expect(byCode(mute, "op112.empty.hail")?.ok).toBe(false);
    expect(byCode(evaluateOp112Rules(emptyInput({ pressed: "noContact", sec: 90 })), "op112.typing_time")?.ok).toBe(false);
  });

  it("a card with services for a silent line is critical: the services would go to a call nobody made", () => {
    const res = evaluateOp112Rules(emptyInput({}));
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ code: "op112.empty.card", ok: false, critical: true });
    expect(res[0].evidence).toContain("ушла в службы (5)");
    expect(computeScore(res, WEIGHTS)).toBeLessThanOrEqual(40);
  });

  it("a break on the first words: «срыв звонка» is right, the break is quoted", () => {
    const early: Persona = { ...silentPersona, line: "drops", dropAfter: 1, opening: "Алло! Алло, это сто двенадцать? Тут у нас…" };
    const messages = [line("counterpart", early.opening!), line("trainee", "Служба 112, что случилось?"), hangup];
    const res = evaluateOp112Rules(emptyInput({ pressed: "dropped", expected: "dropped", persona: early, messages }));
    expect(byCode(res, "op112.empty.button")).toMatchObject({ ok: true });
    expect(byCode(res, "op112.empty.button")?.evidence).toContain("связь прервалась");
    expect(byCode(res, "op112.empty.hail")).toBeUndefined();
  });

  it("a call that broke off after the caller said what and where needs a card, not an empty one", () => {
    const drops: Persona = { ...persona, hiddenAddress: undefined, line: "drops", dropAfter: 3 };
    const messages = [
      line("counterpart", "Алло, тут мусорный контейнер горит, у депо возле Киевского вокзала.", ["situation"]),
      line("trainee", "Назовите адрес"),
      line("counterpart", "МЖД Киевская 1 км, стр. 2", ["address"]),
      line("trainee", "Уточните адрес"),
      hangup,
    ];
    const pressed = evaluateOp112Rules({ ...input({ empty: "noContact" }), persona: drops, messages });
    expect(pressed).toHaveLength(1);
    expect(pressed[0]).toMatchObject({ code: "op112.empty", ok: false, critical: true });
    expect(pressed[0].evidence).toContain("что случилось");
    expect(pressed[0].evidence).toContain("связь прервалась");

    const base = input({ messages });
    const saved = evaluateOp112Rules({ ...base, persona: drops, card: { ...base.card, caller: { ...base.card.caller, fullName: "", provided: "" } } });
    expect(byCode(saved, "op112.dropped.card")).toMatchObject({ ok: true });
    // The caller never got to his name or number: those fields are «не применимо», not mistakes.
    expect(byCode(saved, "op112.field.fullName")).toMatchObject({ ok: null });
    expect(byCode(saved, "op112.field.phone")).toMatchObject({ ok: null });
  });
});
