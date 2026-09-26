/**
 * CSV that opens in Excel with a Russian locale by double click: UTF-8 with BOM, «;» as the
 * separator, CRLF line ends, fields quoted when they contain a separator, a quote or a line break.
 */
export type Cell = string | number | null | undefined;

const BOM = "﻿";

function cell(v: Cell): string {
  if (v == null) return "";
  let s: string;
  if (typeof v === "number") s = Number.isInteger(v) ? String(v) : String(v).replace(".", ",");
  // Text that Excel would run as a formula (=, +, -, @, tab, CR at the start) is shown as plain text.
  else s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[;"\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Cell[][]): string {
  return BOM + rows.map((r) => r.map(cell).join(";")).join("\r\n") + "\r\n";
}

/** Content-Disposition with a Cyrillic file name that every browser understands. */
export function attachment(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "");
  // RFC 5987 does not allow ' ( ) * unencoded, and titles like «… (копия)» have them.
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
