/**
 * The text of a Word document (DOCX) as paragraphs and tables, without a library: word/document.xml is read
 * from the archive (src/lib/files/zip.ts) and walked tag by tag. Kept: the text of runs, tabs, line breaks,
 * table rows and cells (a ticket of the training centre is a table «№ · Ситуация · Адрес»). Left out: deleted
 * revisions and field codes (they are not text runs), the fallback copy of a text box (it repeats the text),
 * headers, footers and notes.
 */
import { readZipEntries, readZipEntry } from "./zip";

export type DocBlock = { kind: "p"; text: string } | { kind: "table"; rows: string[][] };

export class DocxError extends Error {}

const MAX_XML = 40 * 1024 * 1024;
const MAX_TEXT = 2_000_000;

const ENTITIES: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|lt|gt|amp|quot|apos);/g, (whole, code: string) => {
    if (code[0] !== "#") return ENTITIES[code] ?? whole;
    const n = code[1] === "x" || code[1] === "X" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "";
  });
}

type Table = { rows: string[][]; row: string[] | null; cell: string[] | null };

/** XML of word/document.xml → blocks in reading order. Exported for tests. */
export function blocksFromDocumentXml(xml: string): DocBlock[] {
  const blocks: DocBlock[] = [];
  const paragraphs: string[] = [];
  const tables: Table[] = [];
  let inText = false;
  let skip: { tag: string; depth: number } | null = null;
  let size = 0;

  const emit = (text: string) => {
    const table = tables.at(-1);
    if (table?.cell) table.cell.push(text);
    else blocks.push({ kind: "p", text });
  };
  const append = (text: string) => {
    if (!paragraphs.length || size > MAX_TEXT) return;
    paragraphs[paragraphs.length - 1] += text;
    size += text.length;
  };

  const token = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  for (const m of xml.matchAll(token)) {
    const [, cdata, closing, tag, , selfClosing, text] = m;
    if (skip) {
      if (tag === skip.tag) skip.depth += closing ? -1 : selfClosing ? 0 : 1;
      if (skip.depth === 0) skip = null;
      continue;
    }
    if (text !== undefined || cdata !== undefined) {
      if (inText) append(cdata ?? decodeEntities(text));
      continue;
    }
    if (!tag) continue;
    if (!closing && !selfClosing && tag === "mc:Fallback") {
      skip = { tag, depth: 1 };
      continue;
    }
    if (closing) {
      switch (tag) {
        case "w:t":
          inText = false;
          break;
        case "w:p":
          if (paragraphs.length) emit(paragraphs.pop()!.replace(/[  ]+$/g, ""));
          break;
        case "w:tc": {
          const table = tables.at(-1);
          if (table?.row && table.cell) table.row.push(table.cell.join("\n").trim());
          if (table) table.cell = null;
          break;
        }
        case "w:tr": {
          const table = tables.at(-1);
          if (table?.row) table.rows.push(table.row);
          if (table) table.row = null;
          break;
        }
        case "w:tbl": {
          const table = tables.pop();
          if (!table) break;
          // A table inside a cell stays text of that cell: rows on lines, cells split by « | ».
          if (tables.length) emit(table.rows.map((r) => r.filter(Boolean).join(" | ")).join("\n"));
          else blocks.push({ kind: "table", rows: table.rows });
          break;
        }
      }
      continue;
    }
    switch (tag) {
      case "w:t":
        if (!selfClosing) inText = true;
        break;
      case "w:p":
        if (!selfClosing) paragraphs.push("");
        else emit("");
        break;
      case "w:tab":
        append("\t");
        break;
      case "w:br":
      case "w:cr":
        append("\n");
        break;
      case "w:noBreakHyphen":
        append("-");
        break;
      case "w:tbl":
        tables.push({ rows: [], row: null, cell: null });
        break;
      case "w:tr":
        if (tables.length) tables[tables.length - 1].row = [];
        break;
      case "w:tc":
        if (tables.length) tables[tables.length - 1].cell = [];
        break;
    }
  }
  return blocks;
}

/** Paragraphs and tables of a DOCX file. Throws DocxError with a message for the teacher. */
export function docxBlocks(buf: Uint8Array): DocBlock[] {
  const entries = readZipEntries(buf);
  if (!entries) throw new DocxError("Файл повреждён или это не документ Word (DOCX)");
  const main = entries.get("word/document.xml");
  if (!main) throw new DocxError("В файле нет текста документа Word — сохраните его в Word как «Документ Word (*.docx)»");
  let xml: string;
  try {
    xml = new TextDecoder("utf-8").decode(readZipEntry(buf, main, MAX_XML));
  } catch {
    throw new DocxError("Не удалось прочитать текст документа: файл повреждён, зашифрован или слишком велик");
  }
  return blocksFromDocumentXml(xml);
}

/** The document as plain text: paragraphs on lines, table cells split by « · ». */
export function blocksToText(blocks: DocBlock[]): string {
  return blocks
    .map((b) => (b.kind === "p" ? b.text : b.rows.map((r) => r.filter(Boolean).join(" · ")).join("\n")))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
