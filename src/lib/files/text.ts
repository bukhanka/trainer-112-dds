/**
 * A TXT file in whatever the teacher saved it with: UTF-8 (with or without the byte-order mark), «Юникод» of
 * Notepad (UTF-16 with the mark) or Windows-1251 — the default of Russian Windows. Binary files are refused.
 */
export type TextCharset = "utf-8" | "utf-16le" | "utf-16be" | "windows-1251";

/** Control characters other than tab, line feed, form feed and carriage return: a sign of a binary file. */
const CONTROL = /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g;

export function decodeText(buf: Uint8Array): { text: string; charset: TextCharset } | null {
  let text: string;
  let charset: TextCharset;
  try {
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
      charset = "utf-8";
      text = new TextDecoder("utf-8", { fatal: true }).decode(buf.subarray(3));
    } else if (buf[0] === 0xff && buf[1] === 0xfe) {
      charset = "utf-16le";
      text = new TextDecoder("utf-16le", { fatal: true }).decode(buf.subarray(2));
    } else if (buf[0] === 0xfe && buf[1] === 0xff) {
      charset = "utf-16be";
      text = new TextDecoder("utf-16be", { fatal: true }).decode(buf.subarray(2));
    } else {
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
        charset = "utf-8";
      } catch {
        text = new TextDecoder("windows-1251").decode(buf);
        charset = "windows-1251";
      }
    }
  } catch {
    return null;
  }
  const controls = text.match(CONTROL)?.length ?? 0;
  if (text.includes("\u0000") || controls > Math.max(8, text.length / 200)) return null;
  return { text, charset };
}

/** A web page or a script under a .txt name: served as plain text it is harmless, but it is not a training material. */
export function looksLikeMarkup(text: string): boolean {
  const head = text.slice(0, 2000).trimStart().toLowerCase();
  return /^<(!doctype|html|head|body|script|svg|iframe|\?xml)\b/.test(head) || /<script[\s>]/i.test(text.slice(0, 65_536));
}
