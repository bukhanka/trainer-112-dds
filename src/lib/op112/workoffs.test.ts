import { describe, expect, it } from "vitest";
import { dutyGreeting, dutyMockReply, dutyOf, namesCardNumber, passedItems, type DutyContext } from "./duty";
import { evaluateOp112Rules, phonePlates, type EvalInput } from "./evaluate";
import type { CallLine } from "./types";
import { phoneCheck, phoneNotices, sameDuty, unfinishedNotices, workOffInput, type PhoneCall, type WorkOff } from "./workoffs";

const ctx: DutyContext = {
  service: "Деп. ЖКХ",
  serviceFull: "Департамент ЖКХ",
  duty: "Петров",
  cardNumber: 36815072,
  street: "улица Берзарина",
  house: "21",
  what: ["101", "пожар: машина"],
};
const at = "2026-09-27T09:00:00.000Z";
const op = (text: string): CallLine => ({ role: "trainee", text, at });

describe("the duty of a service that gets cards only by phone", () => {
  it("answers with the service and his name; the same card and service always get the same person", () => {
    expect(dutyGreeting(ctx)).toBe("Департамент ЖКХ, дежурный Петров, слушаю.");
    expect(dutyOf(14, 36815072)).toEqual(dutyOf(14, 36815072));
    expect(["male", "female"]).toContain(dutyOf(14, 1).voice);
  });

  it("hears the card number whole, with spaces or by its ending", () => {
    expect(namesCardNumber("Карточка 36815072", 36815072)).toBe(true);
    expect(namesCardNumber("карточка номер 36 815 072", 36815072)).toBe(true);
    expect(namesCardNumber("последние цифры 15072", 36815072)).toBe(true);
    expect(namesCardNumber("карточка 123", 36815072)).toBe(false);
  });

  it("checks the three things it needs: number, address, what happened", () => {
    expect(passedItems(ctx, "Горит машина")).toEqual({ number: false, address: false, what: true });
    expect(passedItems(ctx, "Берзарина 21")).toMatchObject({ address: true, what: false });
    expect(passedItems(ctx, "Карточка 36815072, пожар машины, улица Берзарина, дом 21")).toEqual({ number: true, address: true, what: true });
    // «Происшествие» names nothing: it is on every card.
    expect(passedItems({ ...ctx, what: ["101", "Происшествие 101"] }, "передаю происшествие").what).toBe(false);
  });

  it("asks for what is missing, then takes the card and says who took it", () => {
    const first = dutyMockReply(ctx, [], "Служба 112, оператор 1003. Примите карточку 36815072.");
    expect(first).toEqual({ text: "Что случилось? Какой адрес?", accepted: false });
    const history = [op("Служба 112, оператор 1003. Примите карточку 36815072."), { role: "counterpart" as const, text: first.text, at }];
    const second = dutyMockReply(ctx, history, "Горит машина во дворе, улица Берзарина, дом 21.");
    expect(second.accepted).toBe(true);
    expect(second.text).toContain("Принято");
    expect(second.text).toContain("Петров");
    expect(second.text).toContain("36815072");
    const bye = dutyMockReply(ctx, [...history, op("Горит машина…"), { role: "counterpart", text: second.text, at, accepted: true }], "Спасибо, до связи");
    expect(bye).toEqual({ text: "До связи.", accepted: false });
  });
});

const call = (over: Partial<PhoneCall> & { accept?: boolean } = {}): PhoneCall => ({
  id: "c1",
  serviceId: 14,
  duty: "Петров",
  at,
  messages: [
    { role: "counterpart", text: "Департамент ЖКХ, дежурный Петров, слушаю.", at },
    op("Карточка 36815072, горит машина, Берзарина 21"),
    { role: "counterpart", text: "Принято, передаю бригаде. Дежурный Петров.", at, ...(over.accept === false ? {} : { accepted: true }) },
  ],
  ...over,
});
const row = (over: Partial<WorkOff> = {}): WorkOff => ({ id: "w1", at, operator: "1003", arm: "1", serviceId: 14, service: "Деп. ЖКХ", acceptedBy: "Петров", summary: "принято, передано бригаде", ...over });
const plates = [{ serviceId: 14, name: "Деп. ЖКХ" }];

describe("«Журнал отработок» and the phone check", () => {
  it("a row needs at least one field; blanks are dropped", () => {
    expect(workOffInput.safeParse({}).success).toBe(false);
    expect(workOffInput.safeParse({ acceptedBy: "   " }).success).toBe(false);
    const ok = workOffInput.safeParse({ serviceId: 14, acceptedBy: " Петров ", summary: "" });
    expect(ok.success && ok.data).toMatchObject({ serviceId: 14, acceptedBy: "Петров", summary: undefined });
  });

  it("«кто принял» is the person who answered: the surname, in any form", () => {
    expect(sameDuty("Петров", "Петров")).toBe(true);
    expect(sameDuty("дежурный Петров А.", "Петров")).toBe(true);
    expect(sameDuty("петрову", "Петров")).toBe(true);
    expect(sameDuty("Иванов", "Петров")).toBe(false);
    expect(sameDuty("", "Петров")).toBe(false);
  });

  it("names what is missing for each phone-only plate", () => {
    const problem = (calls: PhoneCall[], log: WorkOff[]) => phoneNotices(plates, calls, log)[0].problem;
    expect(problem([], [])).toBe("no_call");
    expect(problem([call({ accept: false })], [row()])).toBe("not_accepted");
    expect(problem([call()], [])).toBe("no_record");
    expect(problem([call()], [row({ acceptedBy: undefined })])).toBe("no_person");
    expect(problem([call()], [row({ acceptedBy: "Иванов" })])).toBe("wrong_person");
    expect(problem([call()], [row()])).toBeUndefined();
    expect(unfinishedNotices(phoneNotices(plates, [call()], []))).toEqual([{ name: "Деп. ЖКХ", reason: "record" }]);
    expect(unfinishedNotices(phoneNotices(plates, [], []))).toEqual([{ name: "Деп. ЖКХ", reason: "call" }]);
  });

  it("the check waits for «отработана», then quotes the call and the row", () => {
    expect(phoneCheck([], null)).toBeNull();
    expect(phoneCheck(plates, null)).toMatchObject({ code: "op112.phone.notified", ok: null });
    const ok = phoneCheck(plates, phoneNotices(plates, [call()], [row()]))!;
    expect(ok.ok).toBe(true);
    expect(ok.evidence).toContain("дежурный Петров");
    expect(phoneCheck(plates, phoneNotices(plates, [call({ duty: "Васильева" })], [row({ acceptedBy: "Васильева" })]))!.evidence).toContain("дежурная Васильева");
    expect(ok.evidence).toContain("кто принял — Петров");
    const bad = phoneCheck(plates, phoneNotices(plates, [], []))!;
    expect(bad).toMatchObject({ ok: false });
    expect(bad.evidence).toBe("Деп. ЖКХ: не звонили");
    expect(bad.expected).toContain("кто принял");
  });

  it("the rules find the phone-only plates by the directory and add the check to the review", () => {
    const catalog = [
      { id: 1, shortName: "Служба 101", kind: "центральная", orderIdx: 1, delivery: "ARM112" },
      { id: 14, shortName: "Деп. ЖКХ", kind: "ведомственная", orderIdx: 14, delivery: "PHONE" },
    ];
    expect(phonePlates({ serviceIds: [1, 14], catalog })).toEqual(plates);
    const input: EvalInput = {
      card: { caller: {}, address: {}, flags: {}, tags: [], cards: [], typeCodes: [], description: "", openedAt: null, savedAt: null },
      serviceIds: [1, 14],
      persona: null,
      truth: null,
      expectedServices: [],
      messages: [],
      typingSec: 65,
      catalog,
      typeNames: {},
      phoneNotices: phoneNotices(plates, [call()], [row()]),
    };
    expect(evaluateOp112Rules(input).find((c) => c.code === "op112.phone.notified")?.ok).toBe(true);
    expect(evaluateOp112Rules({ ...input, serviceIds: [1] }).some((c) => c.code === "op112.phone.notified")).toBe(false);
  });
});
