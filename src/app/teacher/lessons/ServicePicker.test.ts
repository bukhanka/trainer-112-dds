import { describe, expect, it } from "vitest";
import { serviceGroups, serviceLabel } from "./ServicePicker";

const svc = (id: number, shortName: string, kind: string, fullName: string | null = null) => ({ id, shortName, fullName, kind });

describe("ДДС services in the lesson form", () => {
  it("puts the district first and says what the service is: district, settlement, town or prefecture", () => {
    expect(serviceLabel("Поселение Щукино", "ДДС района Щукино города Москвы")).toBe("Щукино — район");
    expect(serviceLabel("Поселение Академический", "ДДС Академического района города Москвы")).toBe("Академический — район");
    expect(serviceLabel("Поселение Вороновское", "ДДС поселения Вороновское в городе Москве")).toBe("Вороновское — поселение");
    expect(serviceLabel("Поселение Троицк", "ДДС городского округа Троицк города Москвы")).toBe("Троицк — городской округ");
    expect(serviceLabel("Поселение ВАО", "ДДС префектуры Восточного административного округа города Москвы")).toBe("ВАО — префектура");
    expect(serviceLabel("Поселение ЮЗАО")).toBe("ЮЗАО — префектура");
    expect(serviceLabel("Поселение Орехово-Борисово Северное", "ДДС Орехово-Борисово Северное города Москвы")).toBe("Орехово-Борисово Северное — район");
    expect(serviceLabel("Упр. района Вешняки")).toBe("Вешняки — управа района");
    expect(serviceLabel("Служба 103")).toBe("Служба 103");
  });

  it("lists territorial services first, each kind in the alphabet of the district", () => {
    const groups = serviceGroups([
      svc(1, "Служба 101", "центральная"),
      svc(2, "Поселение Щукино", "территориальная", "ДДС района Щукино города Москвы"),
      svc(3, "Упр. района Вешняки", "территориальная"),
      svc(4, "Поселение Академический", "территориальная", "ДДС Академического района города Москвы"),
    ]);
    expect(groups.map(([kind]) => kind)).toEqual(["территориальная", "центральная"]);
    expect(groups[0][1].map((s) => serviceLabel(s.shortName, s.fullName))).toEqual(["Академический — район", "Вешняки — управа района", "Щукино — район"]);
  });
});
