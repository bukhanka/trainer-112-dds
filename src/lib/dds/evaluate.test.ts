import { describe, expect, it } from "vitest";
import type { ServiceStatus } from "@prisma/client";
import type { Weights } from "@/lib/scoring/score";
import { evaluateDdsPlate, phraseCovered, scoreOf, summarize, type PlateEvent, type PlateFacts } from "./evaluate";
import type { DdsReferenceEntry } from "./scenario";

const T0 = Date.UTC(2026, 8, 17, 8, 14, 4);
const at = (sec: number) => new Date(T0 + sec * 1000);
const ev = (status: ServiceStatus, sec: number, comment: string | null = null, crewNumber: string | null = null): PlateEvent => ({
  status,
  comment,
  crewNumber,
  at: at(sec),
  late: false,
});

const weights: Weights = { timeliness: 3, statusOrder: 2, comments: 2, address: 3, services: 3, completeness: 1, literacy: 1 };

const pipeRef: DdsReferenceEntry = {
  decision: "accept",
  why: "Коммунальная авария в доме поселения",
  transferTo: [],
  chain: ["STARTED", "ARRIVED", "WORKING", "FINISHED"],
  finalMust: ["стояк", "устран"],
  crew: { work: "перекрыли стояк", result: "течь устранена" },
  contacts: [],
  traps: [],
};

const liftRef: DdsReferenceEntry = {
  decision: "reject",
  why: "Лифты обслуживает ООО «Практика»",
  transferTo: ["Практик"],
  chain: [],
  finalMust: [],
  crew: {},
  contacts: [],
  traps: [],
};

function facts(over: Partial<PlateFacts>): PlateFacts {
  return {
    addedAt: at(0),
    status: "ADDED",
    events: [ev("ADDED", 0)],
    rules: { noReject: false },
    ackSec: 30,
    workSec: 180,
    reference: pipeRef,
    dispatch: null,
    reports: [],
    crewCalls: { rang: 0, missed: 0 },
    callbacks: [],
    now: at(600),
    ...over,
  };
}

const byCode = (list: ReturnType<typeof evaluateDdsPlate>) => Object.fromEntries(list.map((c) => [c.code, c]));

describe("evaluateDdsPlate", () => {
  it("gives full marks to a clean run by the memo", () => {
    // crew 23 sent at +12 s; stages at +27, +81, +117, +180 after the dispatch
    const events = [
      ev("ADDED", 0),
      ev("RECEIVED", 5),
      ev("ACCEPTED", 12, "Направлена аварийная бригада", "23"),
      ev("STARTED", 45, "Бригада выехала", "23"),
      ev("ARRIVED", 100, "Бригада на месте", "23"),
      ev("WORKING", 140, "Перекрыли стояк, откачивают воду", "23"),
      ev("FINISHED", 200, "Стояк перекрыт, течь устранена, вода подана", "23"),
    ];
    const list = evaluateDdsPlate(
      facts({
        status: "FINISHED",
        events,
        dispatch: { crew: "23", at: at(12), via: "status" },
        reports: [
          { status: "STARTED", at: at(40) },
          { status: "ARRIVED", at: at(94) },
          { status: "WORKING", at: at(130) },
          { status: "FINISHED", at: at(193) },
        ],
        crewCalls: { rang: 4, missed: 0 },
      }),
    );
    const failed = list.filter((c) => c.ok === false);
    expect(failed).toEqual([]);
    expect(byCode(list)["dds.literacy"].ok).toBeNull();
    expect(scoreOf(list, weights)).toBe(100);
    expect(summarize(list, 100)).toContain("Замечаний нет");
  });

  it("catches a late answer, no crew and a bare «Работы завершены»", () => {
    const list = byCode(
      evaluateDdsPlate(
        facts({
          status: "FINISHED",
          events: [ev("ADDED", 0), ev("ACCEPTED", 45), ev("FINISHED", 60, "Работы завершены")],
        }),
      ),
    );
    expect(list["dds.ack_in_time"].ok).toBe(false);
    expect(list["dds.ack_in_time"].evidence).toContain("0:45");
    expect(list["dds.crew_in_time"].ok).toBe(false);
    expect(list["dds.final_comment"].ok).toBe(false);
    expect(list["dds.progress_statuses"].ok).toBe(false);
  });

  it("marks no answer at all as critical", () => {
    const list = evaluateDdsPlate(facts({}));
    const ack = byCode(list)["dds.ack_in_time"];
    expect(ack.ok).toBe(false);
    expect(ack.critical).toBe(true);
    expect(scoreOf(list, weights)).toBeLessThanOrEqual(40);
  });

  it("flags refusing a profile incident and a refusal without «кому передано»", () => {
    const list = byCode(evaluateDdsPlate(facts({ status: "REJECTED", events: [ev("ADDED", 0), ev("REJECTED", 20, "в компетенции 102")] })));
    expect(list["dds.decision"].ok).toBe(false);
    expect(list["dds.decision"].critical).toBe(true);
    expect(list["dds.transfer_named"].ok).toBe(false);
  });

  it("accepts a proper «Не принята» that names where the information went", () => {
    const list = byCode(
      evaluateDdsPlate(
        facts({
          reference: liftRef,
          status: "REJECTED",
          events: [ev("ADDED", 0), ev("REJECTED", 18, "Лифты не обслуживаем, информация передана в диспетчерскую ООО «Практика»")],
        }),
      ),
    );
    expect(list["dds.decision"].ok).toBe(true);
    expect(list["dds.refusal_reason"].ok).toBe(true);
    expect(list["dds.transfer_named"].ok).toBe(true);
    expect(list["dds.ack_in_time"].ok).toBe(true);
  });

  it("treats Служба 103 closing without a crew as its refusal", () => {
    const list = byCode(
      evaluateDdsPlate(
        facts({
          rules: { noReject: true },
          reference: liftRef,
          status: "FINISHED",
          events: [ev("ADDED", 0), ev("FINISHED", 15, "Завершение работ без бригады: помощь не требуется")],
        }),
      ),
    );
    expect(list["dds.decision"].ok).toBe(true);
    expect(list["dds.final_comment"].ok).toBe(true);
    expect(list["dds.crew_in_time"]).toBeUndefined();
  });

  it("catches a status against its meaning", () => {
    const list = byCode(
      evaluateDdsPlate(facts({ status: "ACCEPTED", events: [ev("ADDED", 0), ev("ACCEPTED", 10, "Не обслуживаем территорию")] })),
    );
    expect(list["dds.status_meaning"].ok).toBe(false);
  });

  it("checks crew calls, statuses by reports and the callback", () => {
    const list = byCode(
      evaluateDdsPlate(
        facts({
          status: "ARRIVED",
          events: [ev("ADDED", 0), ev("ACCEPTED", 10, "Направлен наряд", "23"), ev("STARTED", 14, "Выехали"), ev("ARRIVED", 200, "На месте")],
          dispatch: { crew: "23", at: at(10), via: "status" },
          reports: [
            { status: "ARRIVED", at: at(95) },
            { status: "ARRIVED", at: at(150) },
          ],
          crewCalls: { rang: 2, missed: 1 },
          callbacks: [{ at: at(60), namedCardNumber: true }],
        }),
      ),
    );
    expect(list["dds.crew_calls_answered"].ok).toBe(false);
    expect(list["dds.status_by_facts"].ok).toBe(false); // «Начало реагирования» 4 s after sending the crew
    expect(list["dds.status_after_report"].ok).toBe(false); // «Прибытие» 105 s after the report
    expect(list["dds.status_after_report"].evidence?.match(/доклад/g)?.length).toBe(1); // a repeated report counts once
    expect(list["dds.callback_rules"].ok).toBe(false);
  });

  it("wants «Отказ» where the reference closes with a refusal", () => {
    const wireRef: DdsReferenceEntry = { ...pipeRef, chain: ["STARTED", "ARRIVED", "REFUSED"], finalMust: ["Ростелеком"] };
    const list = byCode(
      evaluateDdsPlate(
        facts({
          reference: wireRef,
          status: "FINISHED",
          events: [ev("ADDED", 0), ev("ACCEPTED", 10, "Направлен электрик", "17"), ev("FINISHED", 400, "Провод Ростелекома, работ не проводили")],
          dispatch: { crew: "17", at: at(10), via: "status" },
        }),
      ),
    );
    expect(list["dds.closing_status"].ok).toBe(false);
    expect(list["dds.status_meaning"].ok).toBe(false);
  });
});

describe("phraseCovered", () => {
  it("matches the reference's must-have phrases by word stems", () => {
    const c = "Аварийная газовая служба прибыла в 11:40, кран на вводе перекрыт, утечка устранена, жители предупреждены";
    expect(phraseCovered(c, "кто выехал (аварийная газовая служба)")).toBe(true);
    expect(phraseCovered(c, "что сделано: перекрыт кран, устранена утечка")).toBe(true);
    expect(phraseCovered(c, "жители предупреждены")).toBe(true);
    expect(phraseCovered(c, "время")).toBe(true);
    expect(phraseCovered("Работы завершены", "площадь пожара")).toBe(false);
    expect(phraseCovered("Не обслуживаем, передано в ООО «Практика»", "кому передано (ООО «Практика»)")).toBe(true);
  });

  it("wants at least half of the must-haves in the final comment", () => {
    const events = [ev("ADDED", 0), ev("ACCEPTED", 10, "Направлен наряд", "23"), ev("FINISHED", 400, "Работы выполнены, всё в порядке, закрываем")];
    const list = Object.fromEntries(
      evaluateDdsPlate(facts({ status: "FINISHED", events, dispatch: { crew: "23", at: at(10), via: "status" } })).map((c) => [c.code, c]),
    );
    expect(list["dds.comment_content"].ok).toBe(false);
    expect(list["dds.comment_content"].evidence).toContain("не хватает");
  });

  it("does not ask an okrug ДДС for a crew", () => {
    const info: DdsReferenceEntry = { ...pipeRef, chain: ["FINISHED"], finalMust: ["принято к сведению"] };
    const list = Object.fromEntries(
      evaluateDdsPlate(
        facts({ reference: info, status: "FINISHED", events: [ev("ADDED", 0), ev("ACCEPTED", 12), ev("FINISHED", 300, "Принято к сведению, пожар ликвидирован Службой 101")] }),
      ).map((c) => [c.code, c]),
    );
    expect(list["dds.crew_in_time"]).toBeUndefined();
    expect(list["dds.comment_content"].ok).toBe(true);
    expect(list["dds.progress_statuses"]).toBeUndefined();
  });
});
