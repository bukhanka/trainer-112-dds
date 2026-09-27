import { describe, expect, it } from "vitest";
import { describeTemplates, matchTemplate, normalizeText, parseTemplates, templateProblem } from "./template";

describe("phrase templates of a lesson", () => {
  const templates = parseTemplates("Наряд № {номер} направлен…\nСообщение принято…");

  it("matches a comment that contains any of the templates", () => {
    expect(matchTemplate("Наряд №23 направлен в 14:05, прибыл, течь устранена", templates)).toEqual({ ok: true, template: "Наряд № {номер} направлен…" });
    expect(matchTemplate("наряд N 23-А направлен", templates).ok).toBe(true);
    expect(matchTemplate("Сообщение принято, передано в ДДС района", templates).ok).toBe(true);
    expect(matchTemplate("Итог: сообщение принято к сведению", templates).ok).toBe(true);
  });

  it("does not match a comment written in another way", () => {
    expect(matchTemplate("Направлен наряд 23", templates).ok).toBe(false);
    expect(matchTemplate("Наряд № направлен", templates).ok).toBe(false);
    expect(matchTemplate("", templates).ok).toBe(false);
  });

  it("ignores case, «ё», quotes and punctuation between words", () => {
    expect(matchTemplate("Работы завершены, итоги: течь устранена", parseTemplates("Работы завершены. Итоги: {что сделано}")).ok).toBe(true);
    expect(matchTemplate("Передано в «ГБУ Жилищник» в 14.30", parseTemplates("передано в {кому} в {время}")).ok).toBe(true);
    expect(matchTemplate("Всё сделано", parseTemplates("все сделано")).ok).toBe(true);
    expect(normalizeText("Наряд  №23")).toBe("наряд № 23");
  });

  it("checks placeholders of numbers, time and dates", () => {
    const t = parseTemplates("Прибыли в {время} {дата}");
    expect(matchTemplate("Прибыли в 14:05 27.09", t).ok).toBe(true);
    expect(matchTemplate("Прибыли в обед", t).ok).toBe(false);
  });

  it("explains what the placeholders mean and refuses broken templates", () => {
    expect(describeTemplates(templates)).toBe("{номер} — номер цифрами; «…» — дальше любой текст");
    expect(templateProblem("Наряд {номер")).toContain("непарная");
    expect(templateProblem("{номер}")).toContain("хотя бы одно слово");
    expect(templateProblem("Наряд № {номер}")).toBeNull();
    expect(matchTemplate("Наряд 5", parseTemplates("{номер}")).ok).toBe(false);
  });

  it("keeps at most five templates and drops empty lines", () => {
    expect(parseTemplates("a\n\n b \nc\nd\ne\nf\ng")).toEqual(["a", "b", "c", "d", "e"]);
    expect(parseTemplates(undefined)).toEqual([]);
  });
});
