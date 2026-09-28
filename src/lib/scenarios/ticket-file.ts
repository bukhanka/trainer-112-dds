/**
 * «Сценарий из билета»: the text of an exam ticket file for the «Сценарий из текста» page. The file is read here
 * (DOCX, TXT, a PDF with a text layer) and cut into situations; each situation goes into the text field and then
 * along the usual path of a draft from text (src/lib/scenarios/generate.ts). Nothing of the file is stored.
 *
 * How a file is cut, in the order of the customer's tickets («БИЛЕТ 1 · Отработайте вызовы · № | Ситуация | Адрес»):
 *   1. a short line «Билет N» starts a ticket;
 *   2. a table row numbered «1», «2», … is a situation; its cells are named by the header («Адрес: …»);
 *   3. without such rows, lines numbered «1.», «2.», … in order split the ticket into situations;
 *   4. otherwise the ticket (or the whole file) is one text.
 */
import { blocksToText, docxBlocks, DocxError, type DocBlock } from "@/lib/files/docx";
import { extensionOf } from "@/lib/files/detect";
import { pdfText, PdfError } from "@/lib/files/pdf";
import { decodeText } from "@/lib/files/text";

/** The draft generator reads this much of a text; a longer situation is flagged. */
export const DRAFT_TEXT_LIMIT = 2000;
export const MAX_TICKET_FILE_MB = 20;
const MAX_FRAGMENTS = 200;
const KEEP_TEXT = 6000;

export type TicketFragment = { label: string; text: string; long: boolean };
export type TicketFileResult = { fileName: string; kind: "docx" | "txt" | "pdf"; tickets: number; fragments: TicketFragment[]; notes: string[] };

const TICKET = /^билет\s*(?:№\s*)?(\d{1,3})(?!\d)/i;
const ITEM = /^(\d{1,2})\s*[.)]\s+([\s\S]+)$/;
const ROW_NUMBER = /^(\d{1,2})\s*[.)]?$/;

/** One line of text: tabs and runs of spaces become one space. */
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

type Section = { ticket: string | null; lines: string[]; rows: TicketFragment[] };

/**
 * Parts of a situation as one line of sentences: «Горит мусор, пострадавших нет. Адрес: Москва, …». A line break
 * would end up in the title of the draft, which is the first sentence of the text.
 */
const sentences = (parts: string[]) =>
  parts
    .filter(Boolean)
    .map((p, i, all) => (i < all.length - 1 && !/[.!?:;]$/.test(p) ? `${p}.` : p))
    .join(" ");

/** A situation from a numbered table row, the cells named by the header row when there is one. */
function rowText(cells: string[], header: string[] | null): string {
  const parts: string[] = [];
  cells.forEach((cell, i) => {
    if (!cell) return;
    const name = header?.[i] ?? "";
    if (/адрес/i.test(name)) parts.push(`Адрес: ${cell}`);
    else if (!name || /ситуац|описан|текст|вызов|что случ/i.test(name)) parts.push(cell);
    else parts.push(`${name}: ${cell}`);
  });
  return sentences(parts);
}

const isHeader = (cells: string[]) => cells.every((c) => c.length <= 60) && cells.some((c) => /ситуац|адрес|заявител|описан/i.test(c));

/**
 * Situations of a table: its numbered rows («1 | Возгорание… | Москва, …»), or every row under a header naming
 * the situation or the address when the rows have no numbers. null — the table is not a list of situations.
 */
function tableSituations(rows: string[][]): { n: number; text: string }[] | null {
  const table = rows.map((r) => r.map(oneLine));
  const headerAt = table.slice(0, 3).findIndex(isHeader);
  const header = headerAt >= 0 ? table[headerAt] : null;
  const numbered = table.filter((cells) => ROW_NUMBER.test(cells[0] ?? "") && cells.slice(1).some(Boolean));
  if (numbered.length) {
    // The first column is «№»: the header names the cells after it.
    return numbered.map((cells) => ({ n: Number(ROW_NUMBER.exec(cells[0])![1]), text: rowText(cells.slice(1), header?.slice(1) ?? null) }));
  }
  if (!header) return null;
  const data = table.slice(headerAt + 1).filter((cells) => cells.some(Boolean));
  return data.length ? data.map((cells, i) => ({ n: i + 1, text: rowText(cells, header) })) : null;
}

/** Numbered lines «1.», «2.», … in order split a text into situations; fewer than two — one text. */
function numberedSituations(lines: string[]): string[] {
  const items: string[][] = [];
  for (const line of lines) {
    const m = ITEM.exec(line);
    if (m && Number(m[1]) === items.length + 1) items.push([m[2]]);
    else if (items.length) items[items.length - 1].push(line);
    // Lines before «1.» are the wording of the task: they stay only when the text is not split.
  }
  // Lines of a PDF or a text file break inside sentences: a situation becomes one line again.
  if (items.length >= 2) return items.map((item) => oneLine(item.join(" ")));
  const all = oneLine(lines.join(" "));
  return all ? [all] : [];
}

function fragment(label: string, text: string): TicketFragment {
  return { label, text: text.slice(0, KEEP_TEXT), long: text.length > DRAFT_TEXT_LIMIT };
}

/** Blocks of a document → situations with labels «Билет 3, ситуация 2». */
export function splitTickets(blocks: DocBlock[]): { tickets: number; fragments: TicketFragment[] } {
  const sections: Section[] = [{ ticket: null, lines: [], rows: [] }];
  for (const block of blocks) {
    const section = sections[sections.length - 1];
    if (block.kind === "p") {
      const text = block.text.split("\n").map(oneLine);
      for (const line of text) {
        const heading = TICKET.exec(line);
        if (heading && line.length <= 80) sections.push({ ticket: `Билет ${heading[1]}`, lines: [], rows: [] });
        else sections[sections.length - 1].lines.push(line);
      }
      continue;
    }
    const situations = tableSituations(block.rows);
    if (situations) {
      for (const s of situations) section.rows.push(fragment(`${section.ticket ? `${section.ticket}, ` : ""}ситуация ${s.n}`, s.text));
    } else {
      section.lines.push(...block.rows.map((r) => r.map(oneLine).filter(Boolean).join(" · ")));
    }
  }

  const fragments: TicketFragment[] = [];
  let tickets = 0;
  for (const s of sections) {
    // A ticket laid out as a table: the loose lines around it are its heading and the task wording.
    const found = s.rows.length
      ? s.rows
      : numberedSituations(s.lines).map((text, i, all) =>
          fragment(all.length > 1 ? `${s.ticket ? `${s.ticket}, ` : ""}ситуация ${i + 1}` : (s.ticket ?? "Текст файла"), text),
        );
    if (found.length && s.ticket) tickets++;
    fragments.push(...found);
  }
  return { tickets, fragments: fragments.filter((f) => f.text.length > 0).slice(0, MAX_FRAGMENTS) };
}

const lines = (text: string): DocBlock[] => text.split(/\r\n|\r|\n/).map((line) => ({ kind: "p" as const, text: line }));

type Fail = { ok: false; error: string };

/** Reads an uploaded ticket file. Errors are messages for the teacher. */
export async function ticketsFromFile(fileName: string, bytes: Uint8Array): Promise<{ ok: true; file: TicketFileResult } | Fail> {
  const ext = extensionOf(fileName);
  const notes: string[] = [];
  let blocks: DocBlock[];
  let kind: TicketFileResult["kind"];
  if (!bytes.length) return { ok: false, error: "Файл пустой" };
  if (ext === "docx") {
    kind = "docx";
    try {
      blocks = docxBlocks(bytes);
    } catch (err) {
      return { ok: false, error: err instanceof DocxError ? err.message : "Не удалось прочитать документ Word" };
    }
  } else if (ext === "txt") {
    kind = "txt";
    const decoded = decodeText(bytes);
    if (!decoded) return { ok: false, error: "Это не текстовый файл — сохраните билет в Блокноте или в Word как «Обычный текст»" };
    blocks = lines(decoded.text);
  } else if (ext === "pdf") {
    kind = "pdf";
    if (!new TextDecoder("latin1").decode(bytes.subarray(0, 1024)).includes("%PDF-")) return { ok: false, error: "Файл с расширением .pdf — не PDF" };
    try {
      const pdf = await pdfText(bytes);
      if (pdf.readPages < pdf.pages) notes.push(`Прочитаны первые ${pdf.readPages} страниц из ${pdf.pages}`);
      if (oneLine(pdf.text).length < 20) {
        return { ok: false, error: "В PDF нет текста — похоже, это скан. Сохраните билет из Word в DOCX или TXT, или наберите ситуацию в поле" };
      }
      blocks = lines(pdf.text);
    } catch (err) {
      return { ok: false, error: err instanceof PdfError ? err.message : "Не удалось прочитать PDF" };
    }
  } else if (ext === "doc" || ext === "rtf" || ext === "odt") {
    return { ok: false, error: `Формат .${ext} не читается — откройте файл в Word и сохраните как «Документ Word (*.docx)»` };
  } else {
    return { ok: false, error: "Билет можно загрузить в DOCX, TXT или PDF с текстом" };
  }

  const { tickets, fragments } = splitTickets(blocks);
  if (!fragments.length) return { ok: false, error: "В файле нет текста билета" };
  const long = fragments.filter((f) => f.long).length;
  if (long) notes.push(`${long === 1 && fragments.length === 1 ? "Текст" : `Ситуаций с длинным текстом: ${long}. Текст`} длиннее ${DRAFT_TEXT_LIMIT} символов — в черновик пойдут первые ${DRAFT_TEXT_LIMIT}`);
  if (!tickets && fragments.length === 1 && blocksToText(blocks).length > 4 * DRAFT_TEXT_LIMIT) {
    notes.push("Похоже, это не билет, а большой документ. Методички и инструкции загружайте в раздел «Материалы»");
  }
  return { ok: true, file: { fileName, kind, tickets, fragments, notes } };
}
