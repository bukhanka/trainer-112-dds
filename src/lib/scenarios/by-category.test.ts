import { describe, expect, it } from "vitest";
import { loadJsonReference, readDataJson } from "@/lib/routing/reference-json";
import {
  candidateTypes,
  essence,
  impliedFlags,
  pickPlace,
  pickType,
  presentationFor,
  spokenStreet,
  storyByTemplate,
  streetsIn,
  suggestDifficulty,
  type TypeRow,
} from "./by-category";
import { categoryDef } from "./categories";

const types = readDataJson<{ types: TypeRow[] }>("classifier.json").types;
const reference = loadJsonReference();
const byName = (name: string) => types.find((t) => t.finalType === name)!;

function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const shchukino = { street: "улица Рогова", house: "12", district: "Щукино", okrug: "СЗАО" };

describe("category → classifier leaves", () => {
  it("takes visible leaves of the category's groups that happen at a street address", () => {
    const fire = candidateTypes(categoryDef("пожар")!, types);
    expect(fire.length).toBeGreaterThan(40);
    expect(fire.every((t) => t.groupId === 1 && !t.hiddenFromOperator)).toBe(true);
    const names = fire.map((t) => t.finalType);
    expect(names).toContain("пожар: квартира");
    expect(names.some((n) => /метро|МЦК|вокзал|лес$/.test(n))).toBe(false);
  });

  it("borrows the suspicious object for «угроза взрыва» and leaves out what a generated story must not touch", () => {
    const threat = candidateTypes(categoryDef("угроза взрыва")!, types).map((t) => t.finalType);
    expect(threat).toContain("Подозрительный предмет");
    expect(threat).toContain("Угроза взрыва в жилом доме");
    const danger = candidateTypes(categoryDef("человек в опасности")!, types).map((t) => t.finalType);
    expect(danger).not.toContain("Изнасилование");
    expect(danger).toContain("Лежит человек");
  });

  it("draws different leaves that bring services, nearer the difficulty asked", () => {
    const candidates = candidateTypes(categoryDef("ДТП")!, types);
    const weightOf = (difficulty: number) => {
      const random = seeded(difficulty);
      let sum = 0;
      for (let i = 0; i < 300; i++) {
        const presentation = presentationFor(difficulty, random);
        const c = pickType(candidates, { reference, place: shchukino, presentation, difficulty, ticketCodes: new Set(), usedCodes: new Set(), taken: new Set(), random })!;
        expect(c.services).toBeGreaterThan(0);
        sum += Object.values(impliedFlags(c.type)).filter((v) => v === true).length + c.services;
      }
      return sum / 300;
    };
    expect(weightOf(9)).toBeGreaterThan(weightOf(2));

    const taken = new Set<number>();
    const random = seeded(3);
    for (let i = 0; i < 5; i++) {
      const c = pickType(candidates, { reference, place: shchukino, presentation: presentationFor(null, random), difficulty: null, ticketCodes: new Set(), usedCodes: new Set(), taken, random })!;
      expect(taken.has(c.type.code)).toBe(false);
      taken.add(c.type.code);
    }
  });
});

describe("location → address", () => {
  it("picks a real street of the chosen district, with a house", () => {
    for (let seed = 1; seed < 20; seed++) {
      const p = pickPlace({ okrug: "СЗАО", district: "Щукино" }, seeded(seed))!;
      expect(p).toMatchObject({ okrug: "СЗАО", district: "Щукино" });
      expect(streetsIn({ okrug: "СЗАО", district: "Щукино" }).map((s) => s.street)).toContain(p.street);
      expect(p.house).toMatch(/^\d+/);
    }
  });

  it("keeps to the okrug, or takes any Moscow district with a street", () => {
    const okrugs = new Set<string>();
    for (let seed = 1; seed < 60; seed++) {
      expect(pickPlace({ okrug: "ЦАО" }, seeded(seed))!.okrug).toBe("ЦАО");
      const any = pickPlace(null, seeded(seed))!;
      expect(any.district).toBeTruthy();
      expect(any.okrug).not.toBe("МО");
      okrugs.add(any.okrug);
    }
    expect(okrugs.size).toBeGreaterThan(4);
    expect(pickPlace({ okrug: "СЗАО", district: "Нет такого" }, seeded(1))).toBeNull();
  });

  it("uses the ticket's house when the tickets know the street, and other streets for a second draft", () => {
    const p = pickPlace({ okrug: "СЗАО", district: "Хорошёво-Мнёвники" }, () => 0)!;
    expect(p.street).toBe("ул. Берзарина");
    expect(p).toMatchObject({ house: "21", building: "1" });
    const second = pickPlace({ okrug: "СЗАО", district: "Хорошёво-Мнёвники" }, () => 0, new Set(["берзарина"]))!;
    expect(second.street).not.toBe("ул. Берзарина");
  });

  it("says the street in full words", () => {
    expect(spokenStreet("ул. Берзарина")).toBe("улица Берзарина");
    expect(spokenStreet("Рублёвское ш.")).toBe("Рублёвское шоссе");
    expect(spokenStreet("пр-т Маршала Жукова")).toBe("проспект Маршала Жукова");
  });
});

describe("the story without a model", () => {
  const flat = byName("пожар: квартира");

  it("says the place by the difficulty: exact at once, street and landmark, only the district", () => {
    const easy = storyByTemplate(flat, shchukino, { style: 0, temper: "calm" }, seeded(1));
    expect(easy.caller.visibleAddress).toBe("улица Рогова, дом 12");
    expect(easy.caller.hiddenAddress).toBeUndefined();
    const middle = storyByTemplate(flat, shchukino, { style: 1, temper: "calm" }, seeded(1));
    expect(middle.caller.visibleAddress).toMatch(/^улица Рогова, /);
    expect(middle.caller.visibleAddress).not.toMatch(/12/);
    expect(middle.caller.hiddenAddress).toBe("улица Рогова, дом 12");
    const hard = storyByTemplate(flat, shchukino, { style: 2, temper: "panic" }, seeded(1));
    expect(hard.caller.visibleAddress).toMatch(/^район Щукино, /);
    expect(hard.caller.temper).toBe("panic");
    expect(hard.traps.join(" ")).toMatch(/только район/);
  });

  it("keeps facts and flags in agreement", () => {
    for (let seed = 1; seed < 10; seed++) {
      const st = storyByTemplate(flat, shchukino, { style: 1, temper: "calm" }, seeded(seed));
      expect(st.caller.situation).toBe("Горит квартира.");
      const gasFact = st.caller.facts.find((f) => /газифицирован/.test(f))!;
      expect(/не газифицирован/.test(gasFact)).toBe(st.flags.gas === false);
      if (st.flags.threat) expect(st.caller.facts.some((f) => /угроза людям/.test(f))).toBe(true);
    }
    const crash = storyByTemplate(byName("ДТП без пострадавших - легковой"), shchukino, { style: 0, temper: "calm" }, seeded(2));
    expect(crash.flags.victims).toBe(false);
    expect(crash.caller.facts).toContain("Пострадавших не видно");
    expect(crash.caller.situation).toMatch(/^Авария на дороге: .*вроде все целы\.$/);
  });

  it("speaks in plain words for the main groups", () => {
    expect(essence(byName("Боль в животе"), {})).toBe("Нужна скорая: боль в животе");
    expect(essence(byName("Драка на улице"), {})).toBe("Нужна полиция: драка на улице");
    expect(essence(byName("задымление: мусоропровод"), {})).toBe("Идёт сильный дым — мусоропровод");
    expect(essence(byName("пожар: провода на улице"), {})).toBe("Горят провода на улице");
    expect(essence(byName("ДТП наезд на пешехода"), { victims: true })).toBe("Авария на дороге: сбили пешехода, есть пострадавшие");
  });
});

describe("difficulty the system suggests", () => {
  it("uses the scale of the tickets", () => {
    expect(suggestDifficulty({ style: 0, flags: {}, services: 2, temper: "calm", traps: 0 })).toBe(2);
    expect(suggestDifficulty({ style: 1, flags: { victims: true }, services: 6, temper: "calm", traps: 0 })).toBe(6);
    expect(suggestDifficulty({ style: 2, flags: { victims: true, threat: true, gas: true }, services: 10, temper: "panic", traps: 1 })).toBe(10);
  });

  it("asks for the address style that fits the difficulty", () => {
    expect(presentationFor(2, seeded(1)).style).toBe(0);
    expect(presentationFor(5, seeded(1)).style).toBe(1);
    expect(presentationFor(9, seeded(1))).toMatchObject({ style: 2 });
  });
});
