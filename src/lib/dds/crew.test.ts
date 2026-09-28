import { describe, expect, it } from "vitest";
import { crewPlanFor, crewSchedule, dispatchOf, stageAt } from "./crew";
import {
  callerMockReply,
  claimsCardChange,
  crewGreeting,
  crewMockReply,
  crewByNumber,
  crewPrompt,
  crewRoster,
  mentionsCardError,
  mentionsCardNumber,
  operatorMockReply,
  operatorPrompt,
  owesCardError,
  reportLine,
  toward,
  type CrewContext,
} from "./personas";
import { sayable } from "@/lib/speech/sayable";
import { cardErrorFrom, referenceFor, saysCardErrorRight } from "./scenario";

const at = (sec: number) => new Date(Date.UTC(2026, 8, 17, 8, 0, sec));

describe("crew timeline", () => {
  it("spreads the chain over workSec", () => {
    const schedule = crewSchedule(["STARTED", "ARRIVED", "WORKING", "FINISHED"], 180);
    expect(schedule.map((s) => s.afterSec)).toEqual([27, 81, 117, 180]);
    expect(stageAt(schedule, 10)).toBeNull();
    expect(stageAt(schedule, 90)).toBe("ARRIVED");
    expect(stageAt(schedule, 500)).toBe("FINISHED");
  });

  it("starts from the first status with a crew number or a phone order, whichever is earlier", () => {
    const events = [
      { status: "ADDED" as const, crewNumber: null, at: at(0) },
      { status: "ACCEPTED" as const, crewNumber: null, at: at(10) },
      { status: "STARTED" as const, crewNumber: "23", at: at(40) },
    ];
    expect(dispatchOf(events)).toEqual({ crew: "23", at: at(40), via: "status" });
    expect(dispatchOf(events, [{ crew: "17", at: at(20) }])).toEqual({ crew: "17", at: at(20), via: "phone" });
    expect(dispatchOf(events.slice(0, 2))).toBeNull();
  });

  it("makes a crew sent against the reference refuse on site", () => {
    const { chain, plan } = crewPlanFor({
      decision: "reject",
      why: "лифты обслуживает ООО «Практика»",
      transferTo: [],
      chain: [],
      finalMust: [],
      crew: {},
      contacts: [],
      traps: [],
    });
    expect(chain).toEqual(["STARTED", "ARRIVED", "REFUSED"]);
    expect(plan.refuse).toContain("не наша зона");
  });
});

describe("personas", () => {
  const ctx: CrewContext = {
    crew: "23",
    leader: "Громов Сергей Иванович",
    title: "Аварийная бригада",
    address: "пос. ЛМС, д. 12",
    what: "Прорыв трубы",
    plan: { work: "перекрыли стояк", result: "течь устранена" },
    dispatched: true,
    stage: "WORKING",
  };

  it("gives every service the same three crews", () => {
    const roster = crewRoster({ id: 191, shortName: "Поселение Вороновское" });
    expect(roster.map((c) => c.crew)).toEqual(["23", "17", "8"]);
    expect(crewRoster({ id: 191, shortName: "Поселение Вороновское" })).toEqual(roster);
  });

  it("never lets one leader head a book crew and a crew typed by hand", () => {
    for (const service of [{ id: 191, shortName: "Поселение Вороновское" }, { id: 87, shortName: "Поселение Хорошево-Мневники" }, { id: 1, shortName: "Служба 101" }]) {
      const book = crewRoster(service).map((c) => c.leader);
      const typed = Array.from({ length: 24 }, (_, i) => String(i + 1)).filter((n) => !["8", "17", "23"].includes(n)).map((n) => crewByNumber(service, n));
      for (const c of typed) expect(book, `${service.shortName}, наряд ${c.crew}: ${c.leader}`).not.toContain(c.leader);
      expect(new Set(typed.map((c) => c.leader)).size).toBe(typed.length);
      expect(crewByNumber(service, "Наряд № 16")).toEqual(crewByNumber(service, "16"));
      expect(crewByNumber(service, "8").leader).toBe(book[2]);
    }
  });

  it("says where the crew is going as it is said aloud", () => {
    expect(toward("ул. Грина, д. 11")).toBe("на ул. Грина, д. 11");
    expect(toward("село Вороново, д. 7")).toBe("в село Вороново, д. 7");
    expect(toward("посёлок ЛМС, микрорайон Солнечный, д. 14")).toBe("в посёлок ЛМС, микрорайон Солнечный, д. 14");
    expect(reportLine("STARTED", { ...ctx, address: "ул. Грина, д. 11" })).toMatch(/Выехали на ул\. Грина, д\. 11, скоро будем\./);
    expect(sayable(reportLine("STARTED", { ...ctx, address: "ул. Грина, д. 11" }))).toMatch(/Выехали на улицу Грина, дом 11/);
    expect(sayable(reportLine("STARTED", { ...ctx, address: "село Вороново, д. 7" }))).toMatch(/Выехали в село Вороново, дом 7/);
  });

  it("reports the stage the crew has reached", () => {
    expect(reportLine("WORKING", ctx)).toContain("перекрыли стояк");
    expect(reportLine("FINISHED", ctx)).toContain("Течь устранена");
    const first = crewMockReply(ctx, "Как у вас дела?", 1);
    expect(first.reported).toBe("WORKING");
    expect(crewMockReply(ctx, "Понял, спасибо", 2).reported).toBeNull();
    // the first line after an incoming report is usually «Принято»
    expect(crewMockReply(ctx, "Принято, ставлю начало реагирования", 1).reported).toBeNull();
    expect(crewMockReply(ctx, "Наряд 23, доложите обстановку", 1).reported).toBe("WORKING");
  });

  it("lets a free crew be sent by phone", () => {
    const free = { ...ctx, dispatched: false, stage: null };
    expect(crewMockReply(free, "Добрый день", 1).dispatch).toBe(false);
    const order = crewMockReply(free, "Выезжайте на пос. ЛМС, дом 12, прорыв трубы", 2);
    expect(order.dispatch).toBe(true);
    expect(order.text).toContain("выезжает");
  });

  it("answers the callback from the ticket facts and does not know card numbers", () => {
    const persona = {
      fullName: "Соколова Вера Ивановна",
      role: "хозяйка дома",
      visibleAddress: "посёлок ЛМС, дом 20",
      hiddenAddress: "калитка со стороны леса",
      situation: "пахнет газом у трубы",
      facts: ["Газ магистральный", "Скорая не нужна", "Шум в трубе слышен уже час"],
      voice: "female" as const,
    };
    const c = { persona, cardNumber: 36815003 };
    expect(callerMockReply(c, "Здравствуйте, вы звонили в 112 по поводу газа?", 1)).toContain("Газ магистральный");
    expect(callerMockReply(c, "Уточните точный адрес", 2)).toContain("калитка");
    expect(callerMockReply(c, "Кто-нибудь пострадал?", 3)).toBe("Скорая не нужна.");
    expect(mentionsCardNumber("по карточке 36815003", 36815003)).toBe(true);
    expect(mentionsCardNumber("по карточке 15003", 36815003)).toBe(true);
    expect(mentionsCardNumber("дом 20, подъезд 1", 36815003)).toBe(false);
    expect(mentionsCardNumber("по карточке 36 815 003", 36815003)).toBe(true); // as speech recognition writes it
    expect(mentionsCardNumber("карточка 36-815-003, подъезд 5", 36815003)).toBe(true);
    expect(mentionsCardNumber("телефон +7 916 126 34 71", 36815003)).toBe(false);
    expect(callerMockReply(c, "Карточка 36815003, что у вас?", 2)).toContain("номер");
    expect(callerMockReply(c, "А шум в трубе давно?", 4)).toBe("Шум в трубе слышен уже час.");
    expect(callerMockReply(c, "Добрый день", 1)).toContain("Да, звонила.");
  });
});

describe("an error in the card on the phone", () => {
  const ctx: CrewContext = {
    crew: "23",
    leader: "Громов Сергей Иванович",
    title: "Аварийная бригада",
    address: "ул. Цюрупы, д. 12, корп. 6",
    what: "Горит окно",
    plan: { cardError: "горит в корпусе 5", cardErrorSay: ["корп\\S*\\s*№?\\s*5(?!\\d)"], result: "пожар ликвидирован" },
    dispatched: true,
    stage: "ARRIVED",
  };

  it("the crew tells it on arrival, the 112 operator asks for the card number and the right information", () => {
    expect(reportLine("ARRIVED", ctx)).toMatch(/в карточке ошибка — горит в корпусе 5/);
    expect(reportLine("ARRIVED", { ...ctx, errorTold: true })).toMatch(/в карточке ошибка/); // the arrival report always carries it
    expect(reportLine("ARRIVED", { ...ctx, plan: {} })).toMatch(/Осматриваемся/);
    expect(operatorMockReply("В карточке ошибка, корпус не шестой", 1, { kind: "needNumber" })).toMatch(/номер карточки/);
    expect(operatorMockReply("Карточка 36815070 — ошибка", 1, { kind: "needInfo", card: 36815070 })).toMatch(/Что в ней указать верно/);
  });

  it("a later report carries the error while the dispatcher has not heard one from the site (the arrival call was missed)", () => {
    const finished = { ...ctx, stage: "FINISHED" as const };
    expect(reportLine("FINISHED", finished)).toMatch(/Пожар ликвидирован\. Внимание, диспетчер: в карточке ошибка — горит в корпусе 5\. Возвращаемся на базу/);
    expect(reportLine("FINISHED", { ...finished, errorTold: true })).not.toMatch(/ошибка/);
    // corrected by 112: the card says what the crew sees
    expect(reportLine("FINISHED", { ...finished, errorFixed: true })).not.toMatch(/ошибка/);
    expect(reportLine("ARRIVED", { ...ctx, errorFixed: true })).toMatch(/Осматриваемся/);
    expect(owesCardError(finished)).toBe(true);
    expect(owesCardError({ ...finished, errorTold: true })).toBe(false);
    expect(owesCardError({ ...ctx, stage: "STARTED" })).toBe(false); // on the way the crew does not know it yet
  });

  it("a call back after a missed report: the leader reports at once, the card error included", () => {
    const working = { ...ctx, stage: "WORKING" as const, plan: { ...ctx.plan, work: "тушим" } };
    expect(crewGreeting(working, true)).toMatch(/^Наряд 23, Громов, слушаю\. Докладываю: приступили к работам — тушим\. Внимание, диспетчер: в карточке ошибка — горит в корпусе 5\.$/);
    expect(crewGreeting(working)).toBe("Наряд 23, Громов, слушаю.");
    expect(crewGreeting({ ...working, dispatched: false, stage: null }, true)).toMatch(/Мы на базе/);
  });

  it("on site the crew answers about the address as it is there, not as the card says", () => {
    const told = { ...ctx, stage: "FINISHED" as const, errorTold: true };
    for (const q of ["Адрес в карточке совпал? Подъезд верный?", "Корпус правильный?", "Всё верно по адресу?"]) {
      const reply = crewMockReply(told, q, 2);
      expect(reply.text, q).toMatch(/в карточке ошибка — горит в корпусе 5/);
      expect(reply.text, q).not.toMatch(/Всё верно/);
    }
    expect(crewMockReply({ ...told, errorFixed: true }, "Адрес верный?", 2).text).toBe("Работаем по адресу ул. Цюрупы, д. 12, корп. 6.");
    expect(crewMockReply({ ...ctx, stage: "STARTED" }, "Когда вернётесь?", 2).text).not.toMatch(/ошибка/);
    // The model is told the error on site and that it still owes it to the dispatcher.
    expect(crewPrompt({ ...told, errorTold: false })).toMatch(/в карточке ошибка — горит в корпусе 5.+отвечай так, как на месте[\s\S]+ещё не знает: обязательно скажи/);
    expect(crewPrompt({ ...ctx, stage: "STARTED" })).not.toMatch(/ошибка/);
    expect(mentionsCardError("Горит корпус 5, а не шестой", told)).toBe(true);
    expect(mentionsCardError("Работы закончили", told)).toBe(false);
  });

  it("speaks of time at the pace of the training crew: no «минут через десять»", () => {
    const started = { ...ctx, stage: "STARTED" as const, plan: {} };
    expect(reportLine("STARTED", started)).toMatch(/скоро будем\.$/);
    expect(reportLine("STARTED", started)).not.toMatch(/минут/);
    expect(crewMockReply(started, "Когда будете?", 2).text).toBe("Скоро будем — доложу, как прибудем.");
    expect(crewMockReply({ ...ctx, stage: "WORKING", plan: {} }, "Долго ещё?", 2).text).toBe("Скоро закончим — доложу сразу.");
    expect(crewMockReply({ ...ctx, stage: "WORKING", plan: {} }, "Сколько ещё ждать?", 2).text).toBe("Скоро закончим — доложу сразу.");
    expect(crewMockReply({ ...ctx, stage: "WORKING", plan: {} }, "Сколько пострадавших?", 2).text).not.toMatch(/Скоро/);
    // «Во сколько прибыли?» — by the clock of the place
    const timed = { ...ctx, stage: "FINISHED" as const, plan: {}, timeline: "выехали в 08:12, прибыли в 08:13, закончили в 08:14" };
    expect(crewMockReply(timed, "Во сколько прибыли на место?", 2).text).toBe("По часам: выехали в 08:12, прибыли в 08:13, закончили в 08:14.");
    expect(crewPrompt(timed)).toMatch(/Время этапов по часам: выехали в 08:12/);
    expect(crewPrompt(timed)).toMatch(/Сроки не называй в минутах/);
  });

  it("the 112 operator says the card is corrected only when it has been", () => {
    const fixed = operatorMockReply("Карточка 36815070, горит корпус 5", 2, { kind: "fixed", card: 36815070, label: "корпус 5" });
    expect(fixed).toMatch(/В карточке 36815070 исправил: корпус 5/);
    expect(operatorMockReply("…", 3, { kind: "already", card: 36815070, label: "корпус 5" })).toMatch(/уже внесено: корпус 5/);
    for (const state of [{ kind: "none" as const, card: 36815070 }, { kind: "needNumber" as const }, { kind: "needInfo" as const, card: 36815070 }]) {
      const line = operatorMockReply("Карточка 36815070, улица Цюрупы, дом 12: обстановка изменилась", 2, state);
      expect(claimsCardChange(line), `${state.kind}: ${line}`).toBe(false);
      expect(operatorPrompt("Служба 101", state)).toMatch(/не говори, что исправил/i);
    }
    expect(operatorPrompt("Служба 101", { kind: "fixed", card: 36815070, label: "корпус 5" })).toMatch(/Ты только что исправил карточку 36815070: корпус 5/);
    // the jury heard «данные обновил, службы переоповестил» while the card still said «под. 3»
    expect(claimsCardChange("Принято, данные обновил, службы переоповестил. Всего доброго.")).toBe(true);
    expect(claimsCardChange("Карточка исправлена")).toBe(true);
    expect(claimsCardChange("Принял, исправлю и оповещу службы")).toBe(false);
  });

  it("the reference carries the error to every service and reads the right information", () => {
    const raw = {
      services: [{ service: "Служба 101", decision: "ACCEPTED", chain: ["Начало реагирования", "Прибытие"] }],
      cardError: { what: "корпус", inCard: "корп. 6", onSite: "корпус 5", report: "горит в корпусе 5", mustSay: ["корп\\S*\\s*5(?!\\d)", "(bad"] },
    };
    const ref = referenceFor(raw, { id: 1, shortName: "Служба 101" })!;
    expect(ref.cardError?.mustSay).toHaveLength(1); // a broken pattern is left out
    expect(ref.crew.cardError).toBe("горит в корпусе 5");
    expect(ref.crew.cardErrorSay).toEqual(ref.cardError?.mustSay);
    expect(saysCardErrorRight("горит корпус 5", ref.cardError!)).toBe(true);
    expect(saysCardErrorRight("горит корпус 56", ref.cardError!)).toBe(false);
    // Without `fix` the usual errors are read from their words: the part of the address and its right number, victims.
    expect(ref.cardError?.fix).toEqual({ address: { building: "5" }, flags: {} });
    const error = (v: Record<string, unknown>) => cardErrorFrom({ cardError: { report: "…", ...v } })!;
    expect(error({ what: "подъезд", onSite: "подъезд 5 (в третьем чисто)" }).fix).toEqual({ address: { entrance: "5" }, flags: {} });
    expect(error({ what: "пострадавшие", onSite: "есть пострадавший — мужчина с ожогами рук" }).fix).toEqual({ address: {}, flags: { victims: true } });
    expect(error({ what: "пострадавшие", onSite: "пострадавших нет" }).fix).toEqual({ address: {}, flags: { victims: false } });
    expect(error({ what: "запах", onSite: "пахнет у соседей" }).fix).toBeNull();
    // An explicit fix wins; only known parts and flags are read, null clears a part.
    expect(error({ what: "подъезд", onSite: "подъезд 5", fix: { address: { entrance: 5, code: null, street: "x" }, flags: { victims: "yes", med: true } } }).fix).toEqual({
      address: { entrance: "5", code: null },
      flags: { med: true },
    });
  });
});
