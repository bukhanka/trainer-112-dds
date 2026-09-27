import { describe, expect, it } from "vitest";
import type { CriterionResult } from "@/lib/scoring/score";
import { buildBoard, type BoardInput } from "./state";

const NOW = new Date("2026-09-29T10:10:00Z");
const ago = (sec: number) => new Date(NOW.getTime() - sec * 1000);

const lesson = (over: Partial<BoardInput["lesson"]> = {}): BoardInput["lesson"] => ({
  status: "RUNNING",
  startedAt: ago(600),
  finishedAt: null,
  ackSec: 30,
  workSec: 180,
  typingSec: 65,
  ...over,
});

const seat = (id: string, role: "OP112" | "DDS", extra: Partial<BoardInput["seats"][number]> = {}) => ({
  id,
  label: `Место ${id}`,
  role,
  studentId: `u${id}`,
  studentName: `Ученик ${id}`,
  serviceId: role === "DDS" ? 191 : null,
  serviceName: role === "DDS" ? "Поселение Вороновское" : null,
  scenarioIds: [] as string[],
  ...extra,
});

type Plate = BoardInput["incidents"][number]["plates"][number];
const plate = (id: string, addedSec: number, status: Plate["status"], events: ([Plate["status"], number, string | null] | [Plate["status"], number, string | null, string])[] = [], extra: Partial<Plate> = {}): Plate => ({
  id,
  serviceId: 191,
  serviceName: "Поселение Вороновское",
  delivery: "ARM112",
  visible: true,
  status,
  addedAt: ago(addedSec),
  events: [["ADDED", addedSec, null] as [Plate["status"], number, string | null], ...events].map(([s, sec, seatId, comment]) => ({ status: s, at: ago(sec), seatId, comment: comment ?? null })),
  ...extra,
});

const incident = (id: string, plates: Plate[], extra: Partial<BoardInput["incidents"][number]> = {}) => ({
  id,
  number: Number(id.replace(/\D/g, "")) || 1,
  scenarioId: null,
  title: `Карточка ${id}`,
  address: "Москва",
  source: "generated",
  createdBySeatId: null,
  createdAt: plates[0]?.addedAt ?? ago(100),
  openedAt: null,
  savedAt: plates[0]?.addedAt ?? null,
  plates,
  ...extra,
});

const input = (over: Partial<BoardInput>): BoardInput => ({ lesson: lesson(), seats: [], incidents: [], calls: [], attempts: [], ...over });

describe("buildBoard: ДДС place", () => {
  it("turns the open timer red and marks «Не оповещено» 30 s after «Добавлена» (customer, 27.09)", () => {
    const board = buildBoard(input({ seats: [seat("1", "DDS")], incidents: [incident("i1", [plate("p1", 40, "ADDED", [], { seatId: "1" })])] }), NOW);
    const s = board.seats[0];
    expect(s.timer).toMatchObject({ phase: "open", late: true, normSec: 30 });
    expect(s.state).toBe("late");
    expect(s.red.notNotified).toBe(1);
    expect(board.cards[0].control).toEqual([{ label: "Не оповещено", red: true }]);
  });

  it("after opening in time waits for the first record — a status with a text — and counts the queue", () => {
    const board = buildBoard(
      input({
        seats: [seat("1", "DDS")],
        incidents: [
          incident("i1", [plate("p1", 100, "ACCEPTED", [["RECEIVED", 95, "1"], ["ACCEPTED", 80, "1"]])]),
          incident("i2", [plate("p2", 10, "ADDED", [], { seatId: "1" })]),
        ],
      }),
      NOW,
    );
    const s = board.seats[0];
    expect(s.timer).toMatchObject({ phase: "record", late: false, normSec: 180 }); // «Принята» without a text is not a record
    expect(s.current?.number).toBe(1);
    expect(s.queue).toBe(1);
    expect(s.counts).toEqual({ opened: 1, answered: 0, submitted: 0 });
    expect(s.red.notNotified).toBe(0);

    const recorded = buildBoard(
      input({ seats: [seat("1", "DDS")], incidents: [incident("i1", [plate("p1", 100, "ACCEPTED", [["RECEIVED", 95, "1"], ["ACCEPTED", 80, "1", "Направлен наряд 23"]])])] }),
      NOW,
    ).seats[0];
    expect(recorded.timer).toMatchObject({ phase: "brigade", normSec: null, late: false }); // no other time norms
    expect(recorded.counts.answered).toBe(1);
  });

  it("marks a refusal red and closes the plate", () => {
    const board = buildBoard(input({ seats: [seat("1", "DDS")], incidents: [incident("i1", [plate("p1", 90, "REJECTED", [["REJECTED", 70, "1"]])])] }), NOW);
    expect(board.seats[0].current).toBeNull();
    expect(board.seats[0].red.refused).toBe(1);
    expect(board.seats[0].counts.submitted).toBe(1);
    expect(board.summary.refused).toBe(1);
  });

  it("marks open plates «Не завершено» when the lesson is over", () => {
    const board = buildBoard(
      input({ lesson: lesson({ status: "FINISHED", finishedAt: ago(5) }), seats: [seat("1", "DDS")], incidents: [incident("i1", [plate("p1", 300, "STARTED", [["ACCEPTED", 290, "1"], ["STARTED", 200, "1"]])])] }),
      NOW,
    );
    expect(board.seats[0].timer).toBeNull();
    expect(board.seats[0].red.notFinished).toBe(1);
    expect(board.cards[0].control.map((c) => c.label)).toEqual(["Не завершено"]);
  });

  it("does not grade services nobody plays and phone-only plates", () => {
    const other = plate("p9", 500, "ADDED", [], { serviceId: 181, serviceName: "Поселение ТиНАО" });
    const phone = plate("p8", 500, "ADDED", [], { serviceId: 14, serviceName: "Деп. ЖКХ", delivery: "PHONE" });
    const board = buildBoard(input({ seats: [seat("1", "DDS")], incidents: [incident("i1", [other, phone])] }), NOW);
    expect(board.cards[0].control).toEqual([{ label: "Зарегистрирована", red: false }]);
    expect(board.cards[0].plates.find((p) => p.name === "Деп. ЖКХ")?.phoneOnly).toBe(true);
  });
});

describe("buildBoard: assigning cards to places", () => {
  it("uses the acting place, then the only place with the task", () => {
    const a = seat("1", "DDS", { scenarioIds: ["s1"] });
    const b = seat("2", "DDS", { scenarioIds: ["s2"] });
    const board = buildBoard(
      input({
        seats: [a, b],
        incidents: [
          incident("i1", [plate("p1", 20, "ACCEPTED", [["ACCEPTED", 10, "2"]])]),
          incident("i2", [plate("p2", 15, "ADDED")], { scenarioId: "s1" }),
          incident("i3", [plate("p3", 15, "ADDED")], { scenarioId: "s9" }),
        ],
      }),
      NOW,
    );
    expect(board.seats[1].current?.number).toBe(1);
    expect(board.seats[0].current?.number).toBe(2);
    // Nobody can tell whose card i3 is: it is not graded on any place.
    expect(board.cards.find((c) => c.id === "i3")?.plates[0].seat).toBeNull();
  });
});

describe("buildBoard: 112 place", () => {
  it("shows the typing timer and counts late saves and missed calls", () => {
    const s = seat("5", "OP112");
    const board = buildBoard(
      input({
        seats: [s],
        incidents: [
          incident("i1", [], { source: "op112", createdBySeatId: "5", createdAt: ago(400), openedAt: ago(400), savedAt: ago(300) }),
          incident("i2", [], { source: "op112", createdBySeatId: "5", createdAt: ago(70), openedAt: ago(70), savedAt: null }),
        ],
        calls: [
          { seatId: "5", kind: "CALLER_IN", status: "ENDED", startedAt: ago(405), answeredAt: ago(400) },
          { seatId: "5", kind: "CALLER_IN", status: "MISSED", startedAt: ago(200), answeredAt: null },
          { seatId: "5", kind: "CALLER_IN", status: "ACTIVE", startedAt: ago(72), answeredAt: ago(70) },
        ],
      }),
      NOW,
    );
    const st = board.seats[0];
    expect(st.timer).toMatchObject({ phase: "typing", late: true, normSec: 65 });
    expect(st.lateTyping).toBe(1); // 100 s > 65 s
    expect(st.missedCalls).toBe(1);
    expect(st.counts).toEqual({ opened: 2, answered: 1, submitted: 0 });
    expect(board.cards.find((c) => c.id === "i2")?.control[0].label).toBe("Заполняется");
  });
});

describe("buildBoard: errors", () => {
  it("counts failed checks after the teacher's corrections", () => {
    const criteria: CriterionResult[] = [
      { code: "a", group: "address", title: "Улица записана верно", ok: false, source: "rule" },
      { code: "b", group: "literacy", title: "Описание понятно", ok: false, source: "ai" },
      { code: "c", group: "timeliness", title: "Вовремя", ok: true, source: "rule" },
    ];
    const board = buildBoard(
      input({
        seats: [seat("1", "OP112")],
        attempts: [{ seatId: "1", incidentServiceId: null, reviewStatus: "OVERRIDDEN", score: 50, criteria, override: { b: true } }],
      }),
      NOW,
    );
    expect(board.seats[0].failedChecks).toBe(1);
    expect(board.seats[0].topErrors).toEqual(["Не выполнено: Улица записана верно"]);
    expect(board.summary.pendingReview).toBe(0);
  });
});

describe("buildBoard: cards of the ДДС card flow", () => {
  it("assigns a generated card to its target place, own service only", () => {
    const a = seat("1", "DDS");
    const b = seat("2", "DDS");
    const bot = plate("p-bot", 20, "ACCEPTED", [["ACCEPTED", 10, null]], { serviceId: 1, serviceName: "Служба 101", delivery: "VIS" });
    const board = buildBoard(input({ seats: [a, b], incidents: [incident("i1", [plate("p-own", 20, "ADDED"), bot], { targetSeatId: "2" })] }), NOW);
    expect(board.seats[1].current?.number).toBe(1);
    expect(board.seats[0].current).toBeNull();
    const plates = board.cards[0].plates;
    expect(plates.find((p) => p.name === "Служба 101")?.seat).toBeNull();
    expect(plates.find((p) => p.name === "Поселение Вороновское")?.seat).toBe("Место 2");
  });

  it("shows a shared 112 card in the queue of every place of its service without blaming anyone", () => {
    const board = buildBoard(
      input({
        seats: [seat("1", "DDS"), seat("2", "DDS"), seat("3", "OP112")],
        incidents: [incident("i1", [plate("p1", 45, "ADDED")], { source: "op112", createdBySeatId: "3" })],
      }),
      NOW,
    );
    expect(board.seats[0].current?.number).toBe(1);
    expect(board.seats[1].current?.number).toBe(1);
    expect(board.seats[0].timer?.late).toBe(true);
    expect(board.seats[0].red.notNotified + board.seats[1].red.notNotified).toBe(0);
  });
});

describe("buildBoard: review fixes", () => {
  it("keeps the late mark on the right plate when a hidden plate comes first", () => {
    const hidden = plate("p-hidden", 60, "ACCEPTED", [["ACCEPTED", 55, null]], { serviceId: 999, serviceName: "Невидимая", visible: false });
    const late = plate("p-late", 60, "RECEIVED", [["RECEIVED", 20, "1"]]); // opened 40 s after «Добавлена»
    const onTime = plate("p-ok", 60, "ACCEPTED", [["ACCEPTED", 50, null]], { serviceId: 1, serviceName: "Служба 101", delivery: "VIS" });
    const board = buildBoard(input({ seats: [seat("1", "DDS")], incidents: [incident("i1", [hidden, late, onTime])] }), NOW);
    const plates = board.cards[0].plates;
    expect(plates.map((p) => [p.name, p.late])).toEqual([
      ["Поселение Вороновское", true],
      ["Служба 101", false],
    ]);
  });

  it("turns a shared 112 card red when no place of its service answered", () => {
    const board = buildBoard(
      input({
        seats: [seat("1", "DDS"), seat("2", "DDS"), seat("3", "OP112")],
        incidents: [incident("i1", [plate("p1", 600, "ADDED")], { source: "op112", createdBySeatId: "3" })],
      }),
      NOW,
    );
    expect(board.cards[0].control).toEqual([{ label: "Не оповещено", red: true }]);
    expect(board.summary.notNotified).toBe(1);
    expect(board.seats[0].red.notNotified + board.seats[1].red.notNotified).toBe(0);
  });

  it("does not pin to a place what the system answered or a 112 card in a generated lesson", () => {
    const botDone = plate("p-bot", 300, "STARTED", [["ACCEPTED", 290, null], ["STARTED", 200, null]]);
    const board = buildBoard(
      input({
        lesson: lesson({ cardSource: "generated", status: "FINISHED", finishedAt: ago(1) }),
        seats: [seat("1", "DDS"), seat("5", "OP112")],
        incidents: [
          incident("i1", [botDone], { source: "op112", createdBySeatId: "5" }),
          incident("i2", [plate("p2", 300, "ADDED")], { source: "op112", createdBySeatId: "5" }),
        ],
      }),
      NOW,
    );
    expect(board.seats[0].red).toEqual({ notNotified: 0, refused: 0, notFinished: 0 });
    expect(board.cards.every((c) => !c.control.some((x) => x.red))).toBe(true);
  });

  it("shows no queue after the lesson has ended", () => {
    const board = buildBoard(
      input({
        lesson: lesson({ status: "FINISHED", finishedAt: ago(1) }),
        seats: [seat("1", "DDS")],
        incidents: [incident("i1", [plate("p1", 100, "ADDED", [], { seatId: "1" })]), incident("i2", [plate("p2", 90, "ADDED", [], { seatId: "1" })])],
      }),
      NOW,
    );
    expect(board.seats[0].queue).toBe(0);
    expect(board.seats[0].current).toBeNull();
  });
});

describe("buildBoard: level of the student", () => {
  it("shows the level of the place's role and the difficulty of the current card", () => {
    const board = buildBoard(
      input({
        seats: [seat("1", "DDS", { level: { rating: 1340, difficulty: 4, attempts: 6 } }), seat("2", "OP112")],
        incidents: [incident("i1", [plate("p1", 10, "RECEIVED", [["RECEIVED", 8, "1"]])], { difficulty: 5 })],
      }),
      NOW,
    );
    expect(board.seats[0].level).toEqual({ rating: 1340, difficulty: 4, attempts: 6 });
    expect(board.seats[0].current?.difficulty).toBe(5);
    expect(board.seats[1].level).toBeNull();
  });
});
