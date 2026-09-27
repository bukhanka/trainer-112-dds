import { describe, expect, it } from "vitest";
import { endHold, heldSeconds, openHold, readHolds, resumeLine, startHold } from "./hold";

const at = (sec: number) => new Date(Date.UTC(2026, 8, 27, 8, 0, sec));

describe("«Удержание» periods", () => {
  it("opens one period at a time and closes it on return", () => {
    const one = startHold([], at(10));
    expect(one).toEqual([{ from: at(10).toISOString() }]);
    expect(startHold(one, at(12))).toBe(one); // a second click changes nothing
    const back = endHold(one, at(40));
    expect(back).toEqual([{ from: at(10).toISOString(), to: at(40).toISOString() }]);
    expect(openHold(back)).toBeNull();
    expect(endHold(back, at(50))).toBe(back);
  });

  it("counts the waiting time, the open period up to now", () => {
    const holds = [...endHold(startHold([], at(0)), at(30)), { from: at(60).toISOString() }];
    expect(heldSeconds(holds, at(75).getTime())).toBe(45);
  });

  it("ignores junk stored in the column", () => {
    expect(readHolds(null)).toEqual([]);
    expect(readHolds([{ from: at(1).toISOString() }, { to: "x" }, 5])).toEqual([{ from: at(1).toISOString() }]);
  });

  it("lets the counterpart say they are still on the line", () => {
    expect(resumeLine("crew")).toMatch(/связи/);
    expect(resumeLine("caller")).toMatch(/слушаю/);
    expect(resumeLine("service")).toMatch(/линии/);
  });
});
