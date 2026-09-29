import { describe, expect, it } from "vitest";
import { readDataJson } from "@/lib/routing/reference-json";
import { situationOf } from "@/lib/scenarios/pairs";
import { genderOfName, type Persona } from "./caller";
import { distinctCaller, nameKey, phoneKey, type TakenCaller } from "./identity";
import { findMatches, phoneMatchLink } from "./links";

const ivanova = (situation: string): Persona => ({
  fullName: "Иванова Елена Сергеевна",
  role: "очевидец",
  phone: "+7 (916) 896-32-54",
  visibleAddress: "МКАД, 73 км",
  situation,
  facts: [],
  voice: "female",
});

describe("one caller per situation in a lesson", () => {
  it("the jury's case: four ДТП calls in a row no longer come from one «Иванова Елена Сергеевна» with one number", () => {
    const taken: TakenCaller[] = [];
    const callers = ["Б30-2", "Б31-2", "Б32-2", "Б27-2"].map((ref) => {
      const p = distinctCaller(ivanova(`ДТП ${ref}`), ref, "lesson-1", taken);
      taken.push({ situation: ref, fullName: p.fullName, phone: p.phone });
      return p;
    });
    expect(callers[0]).toMatchObject({ fullName: "Иванова Елена Сергеевна", phone: "+7 (916) 896-32-54" }); // the first keeps the ticket's
    expect(new Set(callers.map((c) => nameKey(c.fullName))).size).toBe(4);
    expect(new Set(callers.map((c) => phoneKey(c.phone))).size).toBe(4);
    for (const c of callers) {
      expect(genderOfName(c.fullName)).toBe("female");
      expect(c.phone).toMatch(/^\+7 \(9\d\d\) \d{3}-\d{2}-\d{2}$/);
    }
  });

  it("is deterministic, and the same situation keeps its caller in the lesson", () => {
    const taken: TakenCaller[] = [{ situation: "Б30-2", fullName: "Иванова Елена Сергеевна", phone: "+7 (916) 896-32-54" }];
    const a = distinctCaller(ivanova("…"), "Б31-2", "lesson-1", taken);
    expect(distinctCaller(ivanova("…"), "Б31-2", "lesson-1", taken)).toEqual(a);
    expect(distinctCaller(ivanova("…"), "Б31-2", "lesson-2", taken).fullName).not.toBe(a.fullName);
    const again = distinctCaller(ivanova("…"), "Б31-2", "lesson-1", [...taken, { situation: "Б31-2", fullName: a.fullName, phone: a.phone }]);
    expect(again).toMatchObject({ fullName: a.fullName, phone: a.phone });
  });

  it("keeps the surname a ticket gives a relative by («Маркова» calls about «Марков Илья»)", () => {
    const p: Persona = { ...ivanova("Папа пропал! Марков Илья Кузьмич, 85 лет"), fullName: "Маркова Ирина Сергеевна" };
    const other = distinctCaller(p, "Б7-3", "lesson-1", [{ situation: "Б2-3", fullName: "Маркова Ирина Сергеевна" }]);
    expect(other.fullName).toMatch(/^Маркова /);
    expect(other.fullName).not.toBe("Маркова Ирина Сергеевна");
  });

  it("in the reference tickets every approved caller of one category gets a pair of its own", () => {
    type Row = { ticketRef: string; category: string; status: string; caller: Persona };
    const rows = readDataJson<Row[]>("scenarios.json").filter((r) => r.status === "APPROVED");
    for (const category of new Set(rows.map((r) => r.category))) {
      const taken: TakenCaller[] = [];
      for (const r of rows.filter((x) => x.category === category)) {
        const situation = situationOf({ id: r.ticketRef, ticketRef: r.ticketRef });
        const p = distinctCaller(r.caller, situation, "lesson-x", taken);
        taken.push({ situation, fullName: p.fullName, phone: p.phone });
      }
      const bySituation = new Map(taken.map((t) => [t.situation, t]));
      expect(new Set([...bySituation.values()].map((t) => phoneKey(t.phone))).size, category).toBe(bySituation.size);
      expect(new Set([...bySituation.values()].map((t) => nameKey(t.fullName))).size, category).toBe(bySituation.size);
    }
  });
});

describe("«Совпадение» does not offer another incident", () => {
  const card = (id: string, street: string, house: string, phone: string, situation: string) => ({
    id,
    situation,
    caller: { aon: phone },
    address: { street, house },
  });

  it("the same number at another place is shown, but not offered for linking; at the same place it is", () => {
    const first = card("c1", "ул. Таманская", "75", "+7 (916) 896-32-54", "Б30-2");
    const now = { caller: { aon: "+7 (916) 896-32-54" }, address: {}, situation: "Б31-2" };
    expect(findMatches(now, [first]).byPhone).toHaveLength(1);
    expect(phoneMatchLink(now, first)).toBe("noPlace");
    expect(phoneMatchLink({ ...now, address: { street: "ул. Грина", house: "11" } }, first)).toBe("otherPlace");
    expect(phoneMatchLink({ ...now, address: { street: "улица Таманская", house: "75" } }, first)).toBe("ok");
  });

  it("a card of the same exercise typed at another place of the lesson is not an earlier call", () => {
    const copy = card("c2", "ул. Грина", "11", "+7 (916) 126-34-71", "Б4-1");
    const mine = { id: "c3", caller: { aon: "+7 (916) 126-34-71" }, address: { street: "ул. Грина", house: "11" }, situation: "Б4-1" };
    expect(findMatches(mine, [copy])).toEqual({ byPhone: [], byAddress: [] });
    // …while a repeat call about it («ПВ-1») finds it by the place.
    expect(findMatches({ ...mine, caller: { aon: "+7 (903) 771-25-40" }, situation: "ПВ-1" }, [copy]).byAddress).toHaveLength(1);
  });
});
