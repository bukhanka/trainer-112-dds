/**
 * What may go into the library of materials: a closed list of document and picture types, each checked twice —
 * by the extension of the name and by the content itself (the signature of the format, the parts of an Office
 * archive, readable text). An .exe renamed to .pdf, a web page under .txt, a Word file with macros or with an
 * embedded program are refused with a plain reason. HTML and SVG are not on the list at all: served from the
 * trainer's own address they could run scripts in the viewer's session.
 */
import { decodeText, looksLikeMarkup } from "./text";
import { readZipEntries } from "./zip";

export type MaterialKind = "pdf" | "docx" | "xlsx" | "pptx" | "txt" | "png" | "jpg" | "gif" | "webp";

type KindInfo = { label: string; exts: string[]; mime: string; inline: boolean };

export const MATERIAL_KINDS: Record<MaterialKind, KindInfo> = {
  pdf: { label: "PDF", exts: ["pdf"], mime: "application/pdf", inline: true },
  docx: { label: "Word", exts: ["docx"], mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", inline: false },
  xlsx: { label: "Excel", exts: ["xlsx"], mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", inline: false },
  pptx: { label: "PowerPoint", exts: ["pptx"], mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", inline: false },
  txt: { label: "Текст", exts: ["txt"], mime: "text/plain", inline: true },
  png: { label: "Рисунок", exts: ["png"], mime: "image/png", inline: true },
  jpg: { label: "Фото", exts: ["jpg", "jpeg"], mime: "image/jpeg", inline: true },
  gif: { label: "Рисунок", exts: ["gif"], mime: "image/gif", inline: true },
  webp: { label: "Рисунок", exts: ["webp"], mime: "image/webp", inline: true },
};

/** «.pdf, .docx, …» for the file picker and the messages. */
export const ACCEPTED_EXTS = Object.values(MATERIAL_KINDS).flatMap((k) => k.exts.map((e) => `.${e}`));
export const ACCEPTED_LIST = "PDF, DOCX, XLSX, PPTX, TXT, PNG, JPG, GIF, WEBP";

export function extensionOf(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
}

export function kindOfExtension(ext: string): MaterialKind | null {
  for (const [kind, info] of Object.entries(MATERIAL_KINDS) as [MaterialKind, KindInfo][]) if (info.exts.includes(ext)) return kind;
  return null;
}

export type Detected = { ok: true; kind: MaterialKind; ext: string; mime: string } | { ok: false; error: string };

const startsWith = (buf: Uint8Array, bytes: number[], at = 0) => bytes.every((b, i) => buf[at + i] === b);
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));

/** The main part of each Office format inside its archive. */
const OFFICE_MAIN: Partial<Record<MaterialKind, string>> = { docx: "word/document.xml", xlsx: "xl/workbook.xml", pptx: "ppt/presentation.xml" };

function officeProblem(kind: MaterialKind, buf: Uint8Array): string | null {
  const entries = readZipEntries(buf);
  const main = OFFICE_MAIN[kind]!;
  if (!entries || !entries.has("[Content_Types].xml") || !entries.has(main)) {
    return `Файл .${MATERIAL_KINDS[kind].exts[0]} повреждён или внутри не документ ${MATERIAL_KINDS[kind].label}`;
  }
  const names = [...entries.keys()];
  if (names.some((n) => /(^|\/)vbaProject\.bin$/i.test(n))) return "Документ с макросами не принимается — сохраните его как обычный документ без макросов";
  if (names.some((n) => /(^|\/)embeddings\/[^/]*\.(bin|exe|dll|bat|cmd|js|vbs|ps1|scr|msi)$/i.test(n) || /(^|\/)activeX\//i.test(n))) {
    return "В документе есть встроенный объект или программа — такой файл не принимается. Сохраните документ без встроенных объектов или в PDF";
  }
  return null;
}

/** The type of an upload by its name and its bytes, or the reason it is refused. */
export function detectMaterial(fileName: string, buf: Uint8Array): Detected {
  const ext = extensionOf(fileName);
  const kind = kindOfExtension(ext);
  if (!kind) return { ok: false, error: `Файлы ${ext ? `.${ext}` : "без расширения"} не принимаются. Можно: ${ACCEPTED_LIST}` };
  if (!buf.length) return { ok: false, error: "Файл пустой" };
  const mismatch = { ok: false as const, error: `Содержимое файла не совпадает с расширением .${ext} — выберите настоящий файл ${MATERIAL_KINDS[kind].label}` };
  const ok = (mime = MATERIAL_KINDS[kind].mime): Detected => ({ ok: true, kind, ext, mime });

  switch (kind) {
    case "pdf": {
      const head = new TextDecoder("latin1").decode(buf.subarray(0, 1024));
      return head.includes("%PDF-") ? ok() : mismatch;
    }
    case "docx":
    case "xlsx":
    case "pptx": {
      if (!startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return mismatch;
      const problem = officeProblem(kind, buf);
      return problem ? { ok: false, error: problem } : ok();
    }
    case "txt": {
      const decoded = decodeText(buf);
      if (!decoded) return { ok: false, error: "Это не текстовый файл — сохраните текст в Блокноте или в Word как «Обычный текст»" };
      if (looksLikeMarkup(decoded.text)) return { ok: false, error: "Похоже на веб-страницу или разметку — такие файлы не принимаются. Сохраните как PDF или обычный текст" };
      return ok(`text/plain; charset=${decoded.charset}`);
    }
    case "png":
      return startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? ok() : mismatch;
    case "jpg":
      return startsWith(buf, [0xff, 0xd8, 0xff]) ? ok() : mismatch;
    case "gif":
      return startsWith(buf, ascii("GIF87a")) || startsWith(buf, ascii("GIF89a")) ? ok() : mismatch;
    case "webp":
      return startsWith(buf, ascii("RIFF")) && startsWith(buf, ascii("WEBP"), 8) ? ok() : mismatch;
  }
}
