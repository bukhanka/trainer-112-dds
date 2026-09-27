/** «Суть и пострадавшие — в первых 100 символах описания» on the reference data (data/scenarios.json). */
import { describe, expect, it } from "vitest";
import { readDataJson } from "@/lib/routing/reference-json";
import { firstHundredMisses, gistOf, normalizeTruth } from "./evaluate";

type Row = { ticketRef: string; status: string; truth: { descriptionKeywords?: string[] }; ddsCard: { description: string } };

const scenarios = readDataJson<Row[]>("scenarios.json");
const approved = scenarios.filter((s) => s.status === "APPROVED");
const truthOf = (s: Row) => normalizeTruth(s.truth)!;
const FOREIGN = "Громко играет музыка во дворе, соседи не спят";

describe("the gist in the first 100 characters", () => {
  it("every approved scenario names its gist explicitly", () => {
    for (const s of approved) expect(s.truth.descriptionKeywords?.length, s.ticketRef).toBeGreaterThan(0);
  });

  it("the ticket's own words pass for every approved scenario", () => {
    for (const s of approved) {
      const t = truthOf(s);
      expect(firstHundredMisses(s.ddsCard.description, t, Boolean(t.flags.victims)).missing, s.ticketRef).toEqual([]);
    }
  });

  it("an empty or a foreign description does not pass", () => {
    for (const s of approved) {
      const t = truthOf(s);
      expect(firstHundredMisses("", t, false).missing.length, s.ticketRef).toBeGreaterThan(0);
      expect(firstHundredMisses(FOREIGN, t, false).missing.length, s.ticketRef).toBeGreaterThan(0);
    }
  });

  it("the gist of a draft comes from what the type means, so its own ticket text passes too", () => {
    const failing = scenarios
      .filter((s) => s.status !== "APPROVED")
      .filter((s) => firstHundredMisses(s.ddsCard.description, truthOf(s), false).missing.length > 0)
      .map((s) => s.ticketRef);
    expect(failing).toEqual([]);
  });

  it("takes the meaning of the type, not the longest word of a category header", () => {
    expect(gistOf("Человек в опасности", "Крики о помощи", ["Человек в опасности", "Человек кричит о помощи"])).toMatch(/крик/);
    expect(gistOf("Человек в опасности", "Поиск в лесу", ["Пропал / найден / похищен", "Заблудился в лесу"])).toMatch(/заблуд/);
    expect(gistOf("103", "Задыхается", ["Задыхается"])).toMatch(/задых/);
    expect(gistOf("Смертельный исход", "Констатация смерти - день", ["В квартире", "Естественная смерть", "день: с 8 до 17 часов"])).toMatch(/скончал/);
    expect(gistOf("Угроза обрушения", "Вокзал платформа жд угроза обрушения", ["Вокзал жд платформа жд"])).toMatch(/обруш/);
    expect(gistOf("101", "пожар: мусор", ["на улице", "мусор", "открытое пламя"])).toMatch(/мусор/);
    // Nothing sure to ask for: the kind's own words («ДТП») are enough.
    expect(gistOf("ДТП", "ДТП без пострадавших - тоннель путепровод", ["ДТП", "Тоннель эстакада путепровод"])).toBeUndefined();
  });

  it("a medical complaint names the victim itself; elsewhere the victim must be said", () => {
    const medical = { descriptionKeywords: ["задых|астм"], kind: "103" };
    expect(firstHundredMisses("Подросток 12 лет задыхается, астма", medical, true).missing).toEqual([]);
    const fire = { descriptionKeywords: ["гор|пожар"], kind: "101" };
    expect(firstHundredMisses("Горит машина у дома", fire, true).missing.length).toBe(1);
    expect(firstHundredMisses("Горит машина, пострадал водитель", fire, true).missing).toEqual([]);
  });
});
