/**
 * Names of uploaded files. The name a teacher's computer sent is only ever shown and offered back as the name of
 * the download — the file on disk has a name the server makes up (src/lib/materials/storage.ts).
 */

/** No folders, no control or reserved characters, at most 100 characters before the extension, which is kept. */
export function cleanFileName(raw: string, ext: string): string {
  const base = (raw.split(/[\\/]/).pop() ?? "")
    .normalize("NFC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
  const suffix = `.${ext}`;
  const stem = (base.toLowerCase().endsWith(suffix) ? base.slice(0, -suffix.length) : base).replace(/^[.\s]+|[.\s]+$/g, "");
  return `${[...(stem || "материал")].slice(0, 100).join("")}${suffix}`;
}

/** A title from the name when the teacher gave none: «Памятка_ДДС-2026.pdf» → «Памятка ДДС-2026». */
export function titleFromFileName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = (dot > 0 ? fileName.slice(0, dot) : fileName).replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return [...(stem || "Материал")].slice(0, 200).join("");
}

/** RFC 5987 value: percent-encoded UTF-8, only attr-char left as is. */
function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Content-Disposition with the Russian name for every browser and a plain ASCII name for old clients. */
export function contentDisposition(type: "inline" | "attachment", fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\;]/g, "_");
  return `${type}; filename="${fallback}"; filename*=UTF-8''${encodeRfc5987(fileName)}`;
}

/** 1 536 → «1,5 КБ», 2 400 000 → «2,3 МБ». */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toLocaleString("ru-RU", { maximumFractionDigits: kb < 10 ? 1 : 0 })} КБ`;
  const mb = kb / 1024;
  return `${mb.toLocaleString("ru-RU", { maximumFractionDigits: mb < 10 ? 1 : 0 })} МБ`;
}
