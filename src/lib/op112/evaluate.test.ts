import { describe, expect, it } from "vitest";
import { computeScore, type Weights } from "@/lib/scoring/score";
import type { Persona } from "./caller";
import { answersToTags, deriveFlags } from "./card";
import { evaluateOp112Ai, evaluateOp112Rules, normalizeTruth, type EvalInput } from "./evaluate";
import type { ServiceLite } from "./routing";
import type { CallLine, CardAnswers } from "./types";

const CATALOG: ServiceLite[] = [
  { id: 1, shortName: "Служба 101", kind: "центральная", orderIdx: 1 },
  { id: 3, shortName: "ЦЭМП", kind: "центральная", orderIdx: 3 },
  { id: 4, shortName: "Служба 103", kind: "центральная", orderIdx: 4 },
  { id: 5, shortName: "Служба 104", kind: "центральная", orderIdx: 5 },
  { id: 7, shortName: "ЦОДД", kind: "ведомственная", orderIdx: 7 },
  { id: 33, shortName: "ОАТИ", kind: "ведомственная", orderIdx: 33 },
  { id: 113, shortName: "Служба 102", kind: "центральная", orderIdx: 113 },
  { id: 60, shortName: "Поселение Дорогомилово", kind: "территориальная", subtype: "район (ДДС управы района)", okrug: "ЗАО", district: "Дорогомилово", orderIdx: 60 },
  { id: 156, shortName: "Поселение ЗАО", kind: "территориальная", subtype: "префектура (ДДС округа)", okrug: "ЗАО", district: "ЗАО", orderIdx: 156 },
];

const WEIGHTS: Weights = { timeliness: 3, statusOrder: 2, comments: 2, address: 3, services: 3, completeness: 1, literacy: 1 };
const FLAME = "Открытое пламя / Дым";

const persona: Persona = {
  fullName: "Сидоров Иван Сергеевич",
  role: "очевидец",
  phone: "+7 (916) 126-34-71",
  visibleAddress: "депо у Киевского вокзала",
  hiddenAddress: "МЖД Киевское направление, 1-й километр, дом 2, строение 2",
  situation: "Горит мусорный контейнер возле депо.",
  facts: [],
  factCards: [
    { key: "victims", topic: "victims", text: "Пострадавших нет.", label: "пострадавшие", expect: { kind: "flag", flag: "victims", value: false } },
    { key: "gas", topic: "gas", text: "Рядом газовая труба, газ подведён.", label: "газификация", expect: { kind: "flag", flag: "gas", value: true } },
  ],
  temper: "calm",
};

const truth = normalizeTruth({
  cards: ["101"],
  tags: [
    { card: "101", row: "Где", value: "Улица" },
    { card: "101", row: "Признак пожара (улица)", value: FLAME },
    { card: "101", row: "Улица (пламя, дым)", value: "Мусор" },
  ],
  flags: { victims: false },
  address: { street: "МЖД Киевское направление 1-й км", house: "2", structure: "2", okrug: "ЗАО", district: "Дорогомилово" },
  services: [],
  requiredQuestions: [
    { text: "Уточнить адрес", topic: "addressExact" },
    { text: "Есть ли пострадавшие", topic: "victims" },
  ],
  callerStatus: "очевидец",
  descriptionKeywords: ["мусор|контейнер", "гор|пожар"],
})!;

const at = "2026-09-26T10:00:00.000Z";
const line = (role: CallLine["role"], text: string, revealed?: string[]): CallLine => ({ role, text, at, revealed });

const goodMessages: CallLine[] = [
  line("counterpart", "Здравствуйте. Горит мусорный контейнер возле депо.", ["situation"]),
  line("trainee", "Назовите адрес"),
  line("counterpart", "депо у Киевского вокзала", ["address"]),
  line("trainee", "Уточните номер дома"),
  line("counterpart", "МЖД Киевское направление, 1-й километр, дом 2, строение 2", ["addressExact"]),
  line("trainee", "Как вас зовут?"),
  line("counterpart", "Сидоров Иван Сергеевич.", ["name"]),
  line("trainee", "Есть пострадавшие?"),
  line("counterpart", "Пострадавших нет.", ["victims"]),
];

function input(over: {
  answers?: CardAnswers;
  top?: Partial<Record<"victims" | "noAccess" | "refusedAmbulance", boolean>>;
  street?: string;
  district?: string;
  description?: string;
  services?: number[];
  messages?: CallLine[];
  savedAfterSec?: number;
  empty?: "noContact";
}): EvalInput {
  const answers = { "101": over.answers ?? { where: ["Улица"], fireStreet: [FLAME], streetObject: ["Мусор"] } };
  const flags = deriveFlags(over.top ?? {}, ["101"], answers);
  const opened = new Date(at);
  return {
    card: {
      caller: { fullName: "Сидоров Иван", status: "очевидец", provided: "+7 (916) 126-34-71", aon: "+7 (916) 126-34-71" },
      address: {
        street: over.street ?? "МЖД Киевское направление 1-й км",
        house: "2",
        structure: "2",
        okrug: "ЗАО",
        district: over.district ?? "Дорогомилово",
      },
      flags,
      tags: answersToTags(["101"], answers),
      cards: ["101"],
      description: over.description ?? "Горит мусорный контейнер у депо Киевского вокзала, пострадавших нет.",
      openedAt: opened,
      savedAt: new Date(opened.getTime() + (over.savedAfterSec ?? 50) * 1000),
      empty: over.empty,
    },
    serviceIds: over.services ?? [1, 7, 33, 60, 156],
    persona,
    truth,
    messages: over.messages ?? goodMessages,
    typingSec: 65,
    catalog: CATALOG,
  };
}

const byCode = (list: ReturnType<typeof evaluateOp112Rules>, code: string) => list.find((c) => c.code === code);

describe("evaluateOp112Rules", () => {
  it("gives full marks to a card that matches the reference and the conversation", () => {
    const res = evaluateOp112Rules(input({}));
    const failed = res.filter((c) => c.ok === false);
    expect(failed).toEqual([]);
    expect(computeScore(res, WEIGHTS)).toBe(100);
  });

  it("marks a look-alike street as a critical mistake and caps the score", () => {
    const res = evaluateOp112Rules(input({ street: "МЖД Киевское направление 2-й км" }));
    const street = byCode(res, "op112.address.street");
    expect(street?.ok).toBe(false);
    expect(street?.critical).toBe(true);
    expect(computeScore(res, WEIGHTS)).toBeLessThanOrEqual(40);
  });

  it("quotes the caller when a said fact is missing from the card", () => {
    const messages = [...goodMessages, line("trainee", "Газ есть?"), line("counterpart", "Рядом газовая труба, газ подведён.", ["gas"])];
    const res = evaluateOp112Rules(input({ messages }));
    const gas = byCode(res, "op112.said.gas");
    expect(gas?.ok).toBe(false);
    expect(gas?.evidence).toContain("«Рядом газовая труба, газ подведён.»");
    expect(gas?.expected).toContain("да");
  });

  it("does not blame the operator for a fact the caller never said", () => {
    const res = evaluateOp112Rules(input({}));
    expect(byCode(res, "op112.said.gas")).toBeUndefined();
  });

  it("checks a reference flag directly when the caller did not speak about it", () => {
    const messages = goodMessages.filter((m) => !m.revealed?.includes("victims") && m.text !== "Есть пострадавшие?");
    const res = evaluateOp112Rules(input({ messages, top: { victims: true } }));
    expect(byCode(res, "op112.said.victims")).toBeUndefined();
    expect(byCode(res, "op112.flag.victims")?.ok).toBe(false);
    expect(byCode(res, "op112.question.2")?.ok).toBe(false);
  });

  it("checks required questions by the operator's own lines", () => {
    const res = evaluateOp112Rules(input({}));
    const q = byCode(res, "op112.question.1");
    expect(q?.ok).toBe(true);
    expect(q?.evidence).toContain("Уточните номер дома");
  });

  it("lists missing and extra services", () => {
    const res = evaluateOp112Rules(input({ services: [1, 7, 60, 156, 113] }));
    expect(byCode(res, "op112.services.missing")?.evidence).toContain("ОАТИ");
    expect(byCode(res, "op112.services.extra")?.evidence).toContain("Служба 102");
  });

  it("fails the typing time after the norm", () => {
    const res = evaluateOp112Rules(input({ savedAfterSec: 95 }));
    expect(byCode(res, "op112.typing_time")?.ok).toBe(false);
  });

  it("wants victims in the first 100 characters when there are victims", () => {
    const description = `${"Горит мусорный контейнер у депо, огонь сильный, чёрный дым, видно издалека, горит уже минут десять."} Есть пострадавший.`;
    const res = evaluateOp112Rules(input({ description, top: { victims: true } }));
    const first = byCode(res, "op112.description.first100");
    expect(first?.ok).toBe(false);
    expect(first?.expected).toContain("пострадав");
  });

  it("flags a wrong district, which loses the territorial services", () => {
    const res = evaluateOp112Rules(input({ district: "Арбат" }));
    expect(byCode(res, "op112.address.district")?.ok).toBe(false);
  });

  it("treats an empty card for a live caller as a critical mistake", () => {
    const res = evaluateOp112Rules(input({ empty: "noContact" }));
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ code: "op112.empty", ok: false, critical: true });
  });
});

describe("normalizeTruth", () => {
  it("accepts plain-string questions and ignores broken parts", () => {
    const t = normalizeTruth({ cards: ["104"], requiredQuestions: ["Уточнить газификацию"], flags: "oops", services: [5, "ЦЭМП"] });
    expect(t?.flags).toEqual({});
    expect(t?.requiredQuestions[0].topic).toBe("gas");
    expect(t?.services).toEqual([5, "ЦЭМП"]);
  });

  it("returns null without a reference", () => {
    expect(normalizeTruth(null)).toBeNull();
  });
});

describe("evaluateOp112Ai", () => {
  it("leaves the model checks «не применимо» when no model is configured", async () => {
    const prev = process.env.LLM_BASE_URL;
    delete process.env.LLM_BASE_URL;
    const res = await evaluateOp112Ai(input({}));
    process.env.LLM_BASE_URL = prev;
    expect(res.map((c) => c.ok)).toEqual([null, null]);
    expect(res.every((c) => c.source === "ai")).toBe(true);
  });
});
