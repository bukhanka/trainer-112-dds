import { describe, expect, it } from "vitest";
import { crewPlanFor, crewSchedule, dispatchOf, stageAt } from "./crew";
import { callerMockReply, crewMockReply, crewRoster, mentionsCardNumber, operatorMockReply, reportLine, type CrewContext } from "./personas";
import { referenceFor, saysCardErrorRight } from "./scenario";

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
    expect(callerMockReply(c, "Карточка 36815003, что у вас?", 2)).toContain("номер");
    expect(callerMockReply(c, "А шум в трубе давно?", 4)).toBe("Шум в трубе слышен уже час.");
    expect(callerMockReply(c, "Добрый день", 1)).toContain("Да, звонила.");
  });
});

describe("an error in the card on the phone", () => {
  it("the crew tells it on arrival, the 112 operator takes the correction", () => {
    const ctx: CrewContext = { crew: "23", leader: "Громов Сергей Иванович", title: "Аварийная бригада", address: "ул. Цюрупы, д. 12", what: "", plan: { cardError: "горит в корпусе 5" }, dispatched: true, stage: "ARRIVED" };
    expect(reportLine("ARRIVED", ctx)).toMatch(/в карточке ошибка — горит в корпусе 5/);
    expect(reportLine("ARRIVED", { ...ctx, plan: {} })).toMatch(/Осматриваемся/);
    expect(operatorMockReply("В карточке ошибка, корпус не шестой", 1)).toMatch(/номер карточки/);
    expect(operatorMockReply("Карточка 36815070 — ошибка, горит корпус 5", 1)).toMatch(/исправлю карточку/);
  });

  it("the reference carries the error to every service and reads the right information", () => {
    const raw = {
      services: [{ service: "Служба 101", decision: "ACCEPTED", chain: ["Начало реагирования", "Прибытие"] }],
      cardError: { what: "корпус", inCard: "корп. 6", onSite: "корпус 5", report: "горит в корпусе 5", mustSay: ["корп\\S*\\s*5(?!\\d)", "(bad"] },
    };
    const ref = referenceFor(raw, { id: 1, shortName: "Служба 101" })!;
    expect(ref.cardError?.mustSay).toHaveLength(1); // a broken pattern is left out
    expect(ref.crew.cardError).toBe("горит в корпусе 5");
    expect(saysCardErrorRight("горит корпус 5", ref.cardError!)).toBe(true);
    expect(saysCardErrorRight("горит корпус 56", ref.cardError!)).toBe(false);
  });
});
