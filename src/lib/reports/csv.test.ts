import { describe, expect, it } from "vitest";
import { attachment, toCsv } from "./csv";

describe("toCsv", () => {
  it("starts with a BOM, uses «;» and CRLF, quotes what needs quoting", () => {
    const csv = toCsv([
      ["ФИО", "Балл", "Ошибки"],
      ["Иванов А. С.", 87, "«Улица»; «Вовремя»"],
      ['Петрова "М"', 12.5, null],
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('ФИО;Балл;Ошибки\r\nИванов А. С.;87;"«Улица»; «Вовремя»"\r\n"Петрова ""М""";12,5;\r\n');
  });

  it("keeps UTF-8 names in the download header", () => {
    expect(attachment("Отчёт.csv")).toBe(`attachment; filename="_____.csv"; filename*=UTF-8''${encodeURIComponent("Отчёт.csv")}`);
    expect(attachment("Отчёт (копия).csv")).toContain("%28%D0%BA%D0%BE%D0%BF%D0%B8%D1%8F%29.csv");
  });

  it("does not let a cell become an Excel formula, but keeps negative numbers", () => {
    const csv = toCsv([["=HYPERLINK(\"http://x\")", "@SUM(A1)", "-5", -5, "+7 916", "Иванов"]]);
    expect(csv.slice(1)).toBe(`"'=HYPERLINK(""http://x"")";'@SUM(A1);'-5;-5;'+7 916;Иванов\r\n`);
  });
});
