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
  });
});
