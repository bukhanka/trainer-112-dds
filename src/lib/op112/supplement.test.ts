import { describe, expect, it } from "vitest";
import { applySupplement, openForSupplement } from "./supplement";

const stored = {
  caller: { fullName: "Кравцова Ольга", status: "очевидец" as const, aon: "+7 (926) 518-44-07" },
  address: { subject: "Москва", street: "улица Рогова", house: "12", district: "Щукино", okrug: "СЗАО" },
  victims: false,
  description: "Во дворе горит машина, людей рядом нет.",
};

describe("«Дополнить»: a saved card gets only what was empty, the description and the victims flag", () => {
  it("a field empty at saving is open, a filled one is not", () => {
    expect(openForSupplement(undefined)).toBe(true);
    expect(openForSupplement("  ")).toBe(true);
    expect(openForSupplement("Кравцова Ольга")).toBe(false);
  });

  it("fills empty fields and keeps the saved ones (name and status cannot change after saving)", () => {
    const s = applySupplement(stored, {
      caller: { fullName: "Иванова Анна", status: "пострадавший", provided: "+7 (926) 518-44-07" },
      address: { ...stored.address, street: "улица Берзарина", entrance: "3", floor: "5" },
      victims: false,
      description: stored.description,
    });
    expect(s.caller.fullName).toBe("Кравцова Ольга");
    expect(s.caller.status).toBe("очевидец");
    expect(s.caller.provided).toBe("+7 (926) 518-44-07");
    expect(s.address.street).toBe("улица Рогова");
    expect(s.address).toMatchObject({ entrance: "3", floor: "5" });
    expect(s.entry).toBe("Дополнено: предоставленный телефон: +7 (926) 518-44-07, подъезд: 3, этаж: 5.");
  });

  it("the added words of the description go to the journal; a rewritten text goes whole", () => {
    const added = applySupplement(stored, { ...stored, description: `${stored.description} Огонь перекинулся на соседнюю машину.` });
    expect(added.entry).toBe("Огонь перекинулся на соседнюю машину.");
    expect(added.description).toContain("соседнюю машину");
    const rewritten = applySupplement(stored, { ...stored, description: "Горят две машины во дворе." });
    expect(rewritten.entry).toBe("Горят две машины во дворе.");
    // An emptied description keeps the saved text.
    expect(applySupplement(stored, { ...stored, description: "" }).description).toBe(stored.description);
  });

  it("several changes make one journal line", () => {
    const both = applySupplement(stored, { ...stored, address: { ...stored.address, flat: "7" }, description: `${stored.description} Дым в подъезде.` });
    expect(both.entry).toBe("Дым в подъезде. Дополнено: квартира: 7.");
  });

  it("the victims flag may change after saving; nothing changed — nothing to write", () => {
    const hurt = applySupplement(stored, { ...stored, victims: true });
    expect(hurt.victims).toBe(true);
    expect(hurt.entry).toBe("Пострадавшие: есть.");
    expect(applySupplement(stored, { ...stored }).entry).toBe("");
  });
});
