/**
 * The tables of a PDF ticket, rebuilt from the positions of its words. A PDF keeps no table: its text layer is a list
 * of words with coordinates, and the order of that list differs from program to program (Word writes a table cell by
 * cell, LibreOffice may write the address of a row before its number). So the rows and columns are found by geometry:
 *
 *   - a header line with «№» and «Ситуация» / «Адрес» starts a table;
 *   - a column starts where most lines under the header begin between two header words (a header word may stand in
 *     the middle of its column);
 *   - a row is a number in the first column; the border between two rows is the widest vertical gap between the
 *     lines lying between their numbers (a number may stand in the middle of its row, or at its top);
 *   - the table ends at the next «Билет N», the next header, or a gap much wider than a line.
 *
 * Everything else on the page stays text lines, in order from the top. Pure: tested on items of real PDFs.
 */
import type { DocBlock } from "./docx";

/** A run of text of a PDF page: its left edge, baseline (up is more) and width, in points. */
export type PdfItem = { str: string; x: number; y: number; w: number; h: number };

type Line = { y: number; items: PdfItem[] };

const HEADER = /ситуац|адрес/i;
const NUMBER = /^№?\s*(\d{1,2})\s*[.)]?$/;
const TICKET = /^билет\s*(?:№\s*)?\d{1,3}(?!\d)/i;
const STARTS_PART = /^(билет\s*(№\s*)?\d|№\s*\d|\d{1,2}\s*[.)|]|\||(ситуация|адрес|описание)\s*[:—-]|отработайте)/i;

/** Items on one baseline, top to bottom; items of a line left to right. */
function linesOf(items: PdfItem[]): Line[] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const tol = Math.max(2, (it.h || 10) * 0.3);
    const line = lines.find((l) => Math.abs(l.y - it.y) <= tol);
    if (line) line.items.push(it);
    else lines.push({ y: it.y, items: [it] });
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines.sort((a, b) => b.y - a.y);
}

const textOf = (items: PdfItem[]) =>
  items
    .map((i) => i.str)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

/** The most frequent x (to a point) among the values, or undefined. */
function modeX(xs: number[]): number | undefined {
  const count = new Map<number, number>();
  for (const x of xs) count.set(Math.round(x), (count.get(Math.round(x)) ?? 0) + 1);
  let best: number | undefined;
  let n = 0;
  for (const [x, c] of count) if (c > n || (c === n && best !== undefined && x < best)) [best, n] = [x, c];
  return best;
}

/** Where the widest gap between the sorted (top to bottom) baselines is: the border of two rows. */
function border(ys: number[]): number {
  let at = (ys[0] + ys[ys.length - 1]) / 2;
  let widest = -1;
  for (let i = 0; i + 1 < ys.length; i++) {
    const gap = ys[i] - ys[i + 1];
    // On equal gaps the lower one wins: a number at the top of its row starts the row right below the border.
    if (gap >= widest) {
      widest = gap;
      at = (ys[i] + ys[i + 1]) / 2;
    }
  }
  return at;
}

/** One table under a header line: the table block and the index of the first line after it. */
function tableAt(lines: Line[], h: number): { block: DocBlock; next: number } | null {
  const header = lines[h].items.filter((i) => i.str.trim());
  // «№ | Ситуация | Адрес» typed as text is a table of a text file: its lines are read as such (ticket-file.ts).
  if (header.length < 2 || textOf(header).includes("|")) return null;
  // Column starts: the first column where the header begins; each next one where most lines below begin between
  // the end of the previous header word and the start of its own.
  const body: Line[] = [];
  const spacing: number[] = [];
  for (let i = h + 1; i < lines.length; i++) {
    const text = textOf(lines[i].items);
    if (TICKET.test(text) || (HEADER.test(text) && /№/.test(text))) break;
    const prev = body.length ? body[body.length - 1].y : lines[h].y;
    const gap = prev - lines[i].y;
    const usual = spacing.length ? [...spacing].sort((a, b) => a - b)[Math.floor(spacing.length / 2)] : (lines[i].items[0].h || 12) * 1.6;
    if (body.length && gap > Math.max(usual * 3, 40)) break;
    if (body.length) spacing.push(gap);
    body.push(lines[i]);
  }
  if (!body.length) return null;
  const starts = [Math.min(...header.map((i) => i.x), ...body.flatMap((l) => l.items.filter((i) => NUMBER.test(i.str.trim())).map((i) => i.x)))];
  for (let k = 1; k < header.length; k++) {
    const from = header[k - 1].x + header[k - 1].w;
    const to = header[k].x + 2;
    const x = modeX(body.flatMap((l) => l.items.filter((i) => i.x > from && i.x <= to).map((i) => i.x)));
    starts.push(x ?? header[k].x);
  }
  const col = (x: number) => {
    let c = 0;
    for (let k = 0; k < starts.length; k++) if (x >= starts[k] - 3) c = k;
    return c;
  };

  // Rows: numbers in the first column, top to bottom.
  const numbers = body.flatMap((l) => l.items.filter((i) => col(i.x) === 0 && NUMBER.test(i.str.trim())));
  if (numbers.length < 1) return null;
  const words = body.flatMap((l) => l.items.map((i) => ({ ...i, y: l.y }))).filter((i) => !numbers.includes(i));
  const ys = [...new Set(words.map((w) => w.y))].sort((a, b) => b - a);
  const borders: number[] = [];
  for (let r = 0; r + 1 < numbers.length; r++) {
    const top = numbers[r].y;
    const bottom = numbers[r + 1].y;
    borders.push(border([top, ...ys.filter((y) => y < top && y > bottom), bottom]));
  }
  const rowOf = (y: number) => {
    let r = 0;
    while (r < borders.length && y < borders[r]) r++;
    return r;
  };
  const rows: string[][] = numbers.map((n) => [n.str.trim(), ...Array<string>(starts.length - 1).fill("")]);
  const cells = new Map<string, PdfItem[]>();
  for (const w of words) {
    const c = col(w.x);
    if (c === 0) continue;
    const key = `${rowOf(w.y)}:${c}`;
    cells.set(key, [...(cells.get(key) ?? []), w]);
  }
  for (const [key, items] of cells) {
    const [r, c] = key.split(":").map(Number);
    rows[r][c] = linesOf(items)
      .map((l) => textOf(l.items))
      .join(" ");
  }
  const head = starts.map((_, k) => textOf(header.filter((i) => col(i.x) === k)));
  return { block: { kind: "table", rows: [head, ...rows] }, next: h + 1 + body.length };
}

/**
 * The pages of a PDF as document blocks: its tables of situations as tables, the rest as lines of text. null when
 * the PDF has no such table — then its plain text is read as a text file is.
 */
export function pdfBlocks(pages: PdfItem[][]): DocBlock[] | null {
  const blocks: DocBlock[] = [];
  let tables = 0;
  const lines = linesOf(stitched(pages));
  for (let i = 0; i < lines.length; i++) {
    const text = textOf(lines[i].items);
    if (/№/.test(text) && HEADER.test(text)) {
      const table = tableAt(lines, i);
      if (table) {
        blocks.push(table.block);
        tables++;
        i = table.next - 1;
        continue;
      }
    }
    blocks.push({ kind: "p", text });
  }
  return tables ? blocks : null;
}

/**
 * The pages one under another, without the margins between them: a table that goes on to the next page (its header
 * at the bottom of one page, or a row broken by the page) reads as one table.
 */
function stitched(pages: PdfItem[][]): PdfItem[] {
  const out: PdfItem[] = [];
  let bottom: number | null = null;
  for (const page of pages) {
    const real = page.filter((i) => i.str.trim());
    if (!real.length) continue;
    const top = Math.max(...real.map((i) => i.y));
    const line = Math.max(12, ...real.map((i) => i.h)) * 1.3;
    const shift: number = bottom === null ? 0 : bottom - line - top;
    for (const i of real) out.push({ ...i, y: i.y + shift });
    bottom = Math.min(...real.map((i) => i.y)) + shift;
  }
  return out;
}

/**
 * The text of a PDF without tables as lines of the source: a line that reaches the right margin was wrapped by the
 * page and goes on in the next one («1 | Возгорание мусорного контейнера, … Сидоров Иван» + «Сергеевич, … | Москва…»).
 */
export function pdfLines(pages: PdfItem[][]): DocBlock[] {
  const out: DocBlock[] = [];
  for (const items of pages) {
    const lines = linesOf(items);
    const right = (l: Line) => Math.max(...l.items.map((i) => i.x + i.w));
    const margin = Math.max(...lines.map(right), 0);
    let joined = "";
    lines.forEach((l, i) => {
      joined = joined ? `${joined} ${textOf(l.items)}` : textOf(l.items);
      // …unless the next line starts a new part: «Билет N», «№ 2», «2 | …», «| Адрес: …», «Адрес: …».
      const next = i + 1 < lines.length ? textOf(lines[i + 1].items) : "";
      const full = right(l) >= margin - 18 && next !== "" && !STARTS_PART.test(next);
      if (!full) {
        out.push({ kind: "p", text: joined });
        joined = "";
      }
    });
    if (joined) out.push({ kind: "p", text: joined });
    out.push({ kind: "p", text: "" });
  }
  return out;
}
