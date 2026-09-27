import { describe, expect, it } from "vitest";
import { serviceGroups, serviceLabel } from "./ServicePicker";

const svc = (id: number, shortName: string, kind: string) => ({ id, shortName, fullName: null, kind });

describe("ДДС services in the lesson form", () => {
  it("puts the district first, so that typing its first letters finds it", () => {
    expect(serviceLabel("Поселение Щукино")).toBe("Щукино — поселение");
    expect(serviceLabel("Упр. района Вешняки")).toBe("Вешняки — управа района");
    expect(serviceLabel("Служба 103")).toBe("Служба 103");
  });

  it("lists territorial services first, each kind in the alphabet of the district", () => {
    const groups = serviceGroups([
      svc(1, "Служба 101", "центральная"),
      svc(2, "Поселение Щукино", "территориальная"),
      svc(3, "Упр. района Вешняки", "территориальная"),
      svc(4, "Поселение Академический", "территориальная"),
    ]);
    expect(groups.map(([kind]) => kind)).toEqual(["территориальная", "центральная"]);
    expect(groups[0][1].map((s) => serviceLabel(s.shortName))).toEqual(["Академический — поселение", "Вешняки — управа района", "Щукино — поселение"]);
  });
});
