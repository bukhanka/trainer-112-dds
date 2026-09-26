import { describe, expect, it } from "vitest";
import { lessonInputSchema, normalizeSeats } from "./form";

const base = (seats: unknown[], extra: Record<string, unknown> = {}) =>
  lessonInputSchema.parse({ title: "Занятие", groupId: "g1", settings: {}, seats, ...extra });

describe("normalizeSeats", () => {
  it("numbers places and drops the service of a 112 place", () => {
    const { seats, error } = normalizeSeats(
      base([
        { studentId: "a", role: "OP112", serviceId: 191, scenarioIds: ["s1"] },
        { studentId: "b", role: "DDS", serviceId: 191, scenarioIds: ["s2", "s2"] },
      ]),
    );
    expect(error).toBeUndefined();
    expect(seats).toEqual([
      { studentId: "a", role: "OP112", serviceId: null, scenarioIds: ["s1"], label: "Место 1" },
      { studentId: "b", role: "DDS", serviceId: 191, scenarioIds: ["s2"], label: "Место 2" },
    ]);
  });

  it("gives every place the same tasks in «одна карточка на всех»", () => {
    const { seats } = normalizeSeats(
      base(
        [
          { studentId: "a", role: "DDS", serviceId: 1, scenarioIds: ["x"] },
          { studentId: "b", role: "OP112", scenarioIds: [] },
        ],
        { settings: { sameCard: true }, sharedScenarioIds: ["s9"] },
      ),
    );
    expect(seats.map((s) => s.scenarioIds)).toEqual([["s9"], ["s9"]]);
  });

  it("rejects a ДДС place without a service and a student on two places", () => {
    expect(normalizeSeats(base([{ studentId: "a", role: "DDS", scenarioIds: [] }])).error).toMatch(/службу/);
    expect(
      normalizeSeats(
        base([
          { studentId: "a", role: "OP112" },
          { studentId: "a", role: "OP112" },
        ]),
      ).error,
    ).toMatch(/двух местах/);
  });

  it("fills settings defaults from the shared schema", () => {
    const input = base([]);
    expect(input.settings).toMatchObject({ ackSec: 30, workSec: 180, cardSource: "generated", sameCard: false });
  });
});
