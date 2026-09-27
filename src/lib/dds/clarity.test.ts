import { describe, expect, it } from "vitest";
import { abbreviationsIn, clarityIssues, commentIssues, fromEnglishLayout, judgedComments, statesResult, type JudgedComment } from "./clarity";

const final = (text: string, status: JudgedComment["status"] = "FINISHED"): JudgedComment => ({ status, text, final: true });
const kinds = (c: JudgedComment, known?: Set<string>) => commentIssues(c, known).map((i) => i.kind);

describe("clarity of a ДДС comment by rules", () => {
  it("passes a full final comment with the result", () => {
    expect(kinds(final("Стояк перекрыт, течь устранена, вода подана"))).toEqual([]);
    expect(kinds(final("Ложное срабатывание датчика в подъезде 1, возгорания нет"))).toEqual([]);
    expect(kinds(final("Сотрудник ГБУ «Жилищник» прибыл, камера очищена, клапан исправен"))).toEqual([]);
  });

  it("finds one-word and cut comments too short", () => {
    expect(kinds(final("Сделано"))).toEqual(["short"]);
    expect(kinds(final("ок"))).toEqual(["short"]);
    expect(kinds({ status: "REJECTED", text: "", final: true })).toEqual(["short"]);
    expect(kinds(final("отпр бр"))).toContain("short");
  });

  it("wants the closing comment to say how it ended", () => {
    expect(kinds(final("Бригада на месте, работают"))).toEqual(["noResult"]);
    expect(kinds(final("Работы завершены"))).toEqual(["noResult"]);
    expect(commentIssues(final("Работы завершены"))[0].hint).toContain("Статус повторять не нужно");
    // A refusal is judged by other checks (reason, «кому передано»), not by the result.
    expect(kinds({ status: "REJECTED", text: "Территория МЖД, передано дежурному по станции", final: true })).toEqual([]);
    expect(statesResult("Пострадавших нет, помощь не потребовалась")).toBe(true);
    expect(statesResult("Горит квартира на 5 этаже")).toBe(false);
  });

  it("flags private abbreviations and keeps official ones", () => {
    const issues = commentIssues(final("Направлена АБ, течь устранена"));
    expect(issues.map((i) => [i.kind, i.fragment])).toEqual([["abbreviation", "АБ"]]);
    expect(issues[0].hint).toContain("аварийная бригада");
    expect(kinds(final("ДДС района уведомлена, ЦЭМП и ГБУ «Жилищник» на месте, течь устранена, СВАО в курсе"))).toEqual([]);
    expect(commentIssues(final("Бриг. выехала, течь устр. в 14:30")).map((i) => i.fragment)).toEqual(["Бриг.", "устр."]);
    expect(commentIssues(final("Прибыла п/б, а/м потушен")).map((i) => i.fragment)).toEqual(["п/б"]);
    expect(kinds(final("ул. Лесная, д. 5, кв. 12: течь устранена"))).toEqual([]);
  });

  it("does not read a comment typed in capitals as abbreviations", () => {
    expect(kinds(final("ТЕЧЬ УСТРАНЕНА, ВОДА ПОДАНА"))).toEqual([]);
  });

  it("takes the words printed on the service plates as official", () => {
    const known = new Set(abbreviationsIn(["ГБУ АД ЮВАО", "Деп. ЖКХ", "Мос.Без."]));
    expect(known.has("АД")).toBe(true);
    expect(known.has("деп")).toBe(true);
    expect(kinds(final("Передано в АД ЮВАО, проезжая часть очищена"), known)).toEqual([]);
    expect(kinds(final("Передано в АД ЮВАО, проезжая часть очищена"))).toEqual(["abbreviation"]);
  });

  it("recognises the English layout and shows the word", () => {
    expect(fromEnglishLayout("ghbyznf")).toBe("принята");
    const issues = commentIssues(final("Течь ecnhfytyf, вода подана"));
    expect(issues.map((i) => i.kind)).toEqual(["layout"]);
    expect(issues[0].hint).toContain("«устранена»");
    expect(kinds(final("Водитель а/м сообщил VIN, машина эвакуирована"))).toEqual([]);
  });

  it("gives the same verdict for the same text", () => {
    const text = "отпр АБ, ghbyznf";
    expect(commentIssues(final(text))).toEqual(commentIssues(final(text)));
  });

  it("skips the result rule for the prescribed phrase of Служба 103", () => {
    const c = [final("Завершение работ без бригады: вызов отменён")];
    expect(clarityIssues(c, new Set(), "Завершение работ без бригады")).toEqual([]);
  });
});

describe("judgedComments", () => {
  it("takes refusals and the closing comment, not the progress ones", () => {
    const list = judgedComments([
      { status: "REJECTED", comment: "Не наш адрес" },
      { status: "ACCEPTED", comment: "Направлена бригада" },
      { status: "STARTED", comment: "выехали" },
      { status: "FINISHED", comment: "Течь устранена" },
    ]);
    expect(list).toEqual([
      { status: "REJECTED", text: "Не наш адрес", final: false },
      { status: "FINISHED", text: "Течь устранена", final: true },
    ]);
  });

  it("treats the last «Не принята» as final when the plate ended there", () => {
    expect(judgedComments([{ status: "REJECTED", comment: "Передано в УК" }])).toEqual([{ status: "REJECTED", text: "Передано в УК", final: true }]);
    expect(judgedComments([{ status: "ACCEPTED", comment: "Направлена бригада" }])).toEqual([]);
  });
});
