/**
 * Real files for the tests, built in memory: a ZIP archive (stored or deflated entries, correct CRC), a Word
 * document with paragraphs and tables, an Excel workbook, a one-page PDF with a text layer.
 */
import { crc32, deflateRawSync } from "node:zlib";

export function makeZip(files: Record<string, string | Uint8Array>, { deflate = true } = {}): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(typeof content === "string" ? Buffer.from(content, "utf8") : content);
    const packed = deflate ? deflateRawSync(data) : data;
    const nameBytes = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    locals.push(local, nameBytes, packed);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(deflate ? 8 : 0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const run = (text: string) => `<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
export const para = (text: string) => `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr>${run(text)}</w:p>`;
export const table = (rows: string[][]) =>
  `<w:tbl><w:tblPr/>${rows.map((r) => `<w:tr>${r.map((c) => `<w:tc><w:tcPr/>${c.split("\n").map(para).join("")}</w:tc>`).join("")}</w:tr>`).join("")}</w:tbl>`;

export const documentXml = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><w:body>${body}<w:sectPr/></w:body></w:document>`;

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>`;

export function makeDocx(body: string, extra: Record<string, string | Uint8Array> = {}): Uint8Array {
  return makeZip({ "[Content_Types].xml": CONTENT_TYPES, "_rels/.rels": "<Relationships/>", "word/document.xml": documentXml(body), ...extra });
}

export function makeXlsx(extra: Record<string, string | Uint8Array> = {}): Uint8Array {
  return makeZip({ "[Content_Types].xml": CONTENT_TYPES, "xl/workbook.xml": "<workbook/>", "xl/worksheets/sheet1.xml": "<worksheet/>", ...extra });
}

/** A one-page PDF whose text layer says `text` (Latin letters, Helvetica). */
export function makePdf(text: string): Uint8Array {
  const stream = `BT /F1 18 Tf 72 720 Td (${text.replace(/[()\\]/g, (c) => `\\${c}`)}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}

/** Bytes that start like a Windows program. */
export const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, ...new Array(200).fill(0)]);
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, ...new Array(40).fill(1)]);
