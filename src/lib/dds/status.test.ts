import { describe, expect, it } from "vitest";
import { allowedNext, checkTransition, isFirstAnswer, isLate, NO_CREW_COMMENT, rulesFor, STATUS_LABEL, type ServiceRules, isRecord, normMoments } from "./status";

const plain: ServiceRules = { noReject: false };
const s103: ServiceRules = { noReject: true };

describe("rulesFor", () => {
  it("treats only Служба 103 as the no-reject exception", () => {
    expect(rulesFor({ shortName: "Служба 103" }).noReject).toBe(true);
    expect(rulesFor({ shortName: "Служба 101" }).noReject).toBe(false);
    expect(rulesFor({ shortName: "Поселение Вороновское" }).noReject).toBe(false);
    expect(rulesFor({ shortName: "ЦЭМП" }).noReject).toBe(false);
    expect(rulesFor(null).noReject).toBe(false);
  });
});

describe("allowedNext", () => {
  it("offers only Принята / Не принята as the first answer", () => {
    expect(allowedNext("ADDED", plain)).toEqual(["ACCEPTED", "REJECTED"]);
    expect(allowedNext("RECEIVED", plain)).toEqual(["ACCEPTED", "REJECTED"]);
  });

  it("allows only Принята after Не принята", () => {
    expect(allowedNext("REJECTED", plain)).toEqual(["ACCEPTED"]);
  });

  it("opens every progress step after Принята, steps may be skipped", () => {
    expect(allowedNext("ACCEPTED", plain)).toEqual(["STARTED", "ARRIVED", "WORKING", "REFUSED", "FINISHED"]);
    expect(allowedNext("STARTED", plain)).toEqual(["ARRIVED", "WORKING", "REFUSED", "FINISHED"]);
    expect(allowedNext("WORKING", plain)).toEqual(["REFUSED", "FINISHED"]);
  });

  it("never goes back and closes after Работы завершены / Отказ", () => {
    expect(allowedNext("ARRIVED", plain)).not.toContain("STARTED");
    expect(allowedNext("ARRIVED", plain)).not.toContain("ACCEPTED");
    expect(allowedNext("FINISHED", plain)).toEqual([]);
    expect(allowedNext("REFUSED", plain)).toEqual([]);
  });

  it("gives Служба 103 «Работы завершены» instead of «Не принята» and «Отказ»", () => {
    expect(allowedNext("RECEIVED", s103)).toEqual(["ACCEPTED", "FINISHED"]);
    expect(allowedNext("ACCEPTED", s103)).toEqual(["STARTED", "ARRIVED", "WORKING", "FINISHED"]);
    for (const status of Object.keys(STATUS_LABEL) as (keyof typeof STATUS_LABEL)[]) {
      expect(allowedNext(status, s103)).not.toContain("REJECTED");
      expect(allowedNext(status, s103)).not.toContain("REFUSED");
    }
  });
});

describe("checkTransition", () => {
  it("accepts a valid step and keeps the crew number between statuses", () => {
    const first = checkTransition({ current: "RECEIVED", next: "ACCEPTED", crewNumber: " 23 ", comment: "Отправлен сантехник", rules: plain });
    expect(first).toEqual({ ok: true, crewNumber: "23", comment: "Отправлен сантехник" });
    const second = checkTransition({ current: "ACCEPTED", next: "STARTED", crewNumber: "", currentCrew: "23", rules: plain });
    expect(second).toEqual({ ok: true, crewNumber: "23", comment: null });
  });

  it("rejects a step that is not in the list", () => {
    const res = checkTransition({ current: "REJECTED", next: "STARTED", rules: plain });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("«Принята»");
    expect(checkTransition({ current: "ARRIVED", next: "STARTED", rules: plain }).ok).toBe(false);
  });

  it("requires a comment for Не принята, Отказ and Работы завершены", () => {
    expect(checkTransition({ current: "ADDED", next: "REJECTED", comment: "  ", rules: plain }).ok).toBe(false);
    expect(checkTransition({ current: "ACCEPTED", next: "REFUSED", rules: plain }).ok).toBe(false);
    expect(checkTransition({ current: "WORKING", next: "FINISHED", comment: "", rules: plain }).ok).toBe(false);
    expect(checkTransition({ current: "ADDED", next: "REJECTED", comment: "Не наша территория, передано в ДДС Троицка", rules: plain }).ok).toBe(true);
  });

  it("refuses any change once the card is closed for the service", () => {
    const res = checkTransition({ current: "FINISHED", next: "FINISHED", comment: "ещё", rules: plain });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("отдел контроля");
  });

  it("makes 103 close without a crew only with the «без бригады» comment", () => {
    expect(checkTransition({ current: "RECEIVED", next: "FINISHED", comment: "не поедем", rules: s103 }).ok).toBe(false);
    expect(checkTransition({ current: "RECEIVED", next: "FINISHED", comment: NO_CREW_COMMENT, rules: s103 }).ok).toBe(true);
    expect(checkTransition({ current: "RECEIVED", next: "REJECTED", comment: "нет", rules: s103 }).ok).toBe(false);
    // after a real trip the final comment is free text
    expect(checkTransition({ current: "ARRIVED", next: "FINISHED", comment: "Госпитализирован в ГКБ 29", rules: s103 }).ok).toBe(true);
  });

  it("normalises spaces in the comment", () => {
    const res = checkTransition({ current: "ADDED", next: "ACCEPTED", comment: "  выехал   наряд  ", rules: plain });
    expect(res.ok && res.comment).toBe("выехал наряд");
  });
});

describe("timing", () => {
  it("marks an answer later than ackSec after «Добавлена»", () => {
    const added = new Date("2026-09-17T11:14:04Z");
    expect(isLate(added, new Date("2026-09-17T11:14:34Z"), 30)).toBe(false);
    expect(isLate(added, new Date("2026-09-17T11:14:35Z"), 30)).toBe(true);
    expect(isLate(added, new Date("2026-09-17T11:23:21Z"), 30)).toBe(true);
  });

  it("counts only the first answer for the 30-second norm", () => {
    expect(isFirstAnswer("RECEIVED", "ACCEPTED")).toBe(true);
    expect(isFirstAnswer("ADDED", "REJECTED")).toBe(true);
    expect(isFirstAnswer("REJECTED", "ACCEPTED")).toBe(false);
    expect(isFirstAnswer("ACCEPTED", "STARTED")).toBe(false);
  });
});

describe("the two norms of the customer's answer of 27.09", () => {
  const t = (sec: number) => new Date(Date.UTC(2026, 8, 27, 8, 0, sec));
  it("counts the card opened at its first event after «Добавлена» and the first record at a status with a text", () => {
    const events = [
      { status: "ADDED" as const, comment: null, at: t(0) },
      { status: "RECEIVED" as const, comment: null, at: t(12) },
      { status: "ACCEPTED" as const, comment: "  ", at: t(20) },
      { status: "STARTED" as const, comment: "Наряд 23 выехал", at: t(95) },
    ];
    expect(normMoments(events)).toEqual({ openedAt: t(12), recordAt: t(95) });
    expect(isRecord({ status: "ACCEPTED", comment: null })).toBe(false);
    expect(isRecord({ status: "RECEIVED", comment: "текст" })).toBe(false);
    expect(isRecord({ status: "REJECTED", comment: "Не наш район, передано в ДДС Строгино" })).toBe(true);
  });
});
