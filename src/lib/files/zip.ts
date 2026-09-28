/**
 * Just enough of the ZIP format to look inside an Office file — DOCX, XLSX and PPTX are ZIP archives: the list of
 * entries from the central directory and the bytes of one entry, inflated by node:zlib. The output of an entry is
 * capped, so a «zip bomb» stops at the cap instead of filling the memory. Encrypted, multi-volume and ZIP64
 * archives are refused: an Office document under 20 MB is never one of them.
 */
import { inflateRawSync } from "node:zlib";

export type ZipEntry = {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  offset: number;
};

export class ZipError extends Error {}

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_HEADER = 0x04034b50;
const MAX_ENTRIES = 20_000;

function view(buf: Uint8Array): DataView {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

/** Entries by name, or null when the bytes are not a ZIP archive this reader can open. */
export function readZipEntries(buf: Uint8Array): Map<string, ZipEntry> | null {
  if (buf.length < 22) return null;
  const v = view(buf);
  // The end record is the last thing in the file, followed only by a comment of up to 64 KB.
  let end = -1;
  for (let p = buf.length - 22; p >= Math.max(0, buf.length - 22 - 0xffff); p--) {
    if (v.getUint32(p, true) === END_OF_DIRECTORY) {
      end = p;
      break;
    }
  }
  if (end < 0) return null;
  const disk = v.getUint16(end + 4, true);
  const directoryDisk = v.getUint16(end + 6, true);
  const total = v.getUint16(end + 10, true);
  const directorySize = v.getUint32(end + 12, true);
  const directoryOffset = v.getUint32(end + 16, true);
  if (disk !== 0 || directoryDisk !== 0) return null; // split archive
  if (total === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) return null; // ZIP64
  if (total > MAX_ENTRIES || directoryOffset + directorySize > end) return null;

  const entries = new Map<string, ZipEntry>();
  const decoder = new TextDecoder("utf-8");
  let p = directoryOffset;
  for (let i = 0; i < total; i++) {
    if (p + 46 > end || v.getUint32(p, true) !== DIRECTORY_ENTRY) return null;
    const nameLength = v.getUint16(p + 28, true);
    const extraLength = v.getUint16(p + 30, true);
    const commentLength = v.getUint16(p + 32, true);
    if (p + 46 + nameLength > end) return null;
    const entry: ZipEntry = {
      name: decoder.decode(buf.subarray(p + 46, p + 46 + nameLength)),
      flags: v.getUint16(p + 8, true),
      method: v.getUint16(p + 10, true),
      compressedSize: v.getUint32(p + 20, true),
      size: v.getUint32(p + 24, true),
      offset: v.getUint32(p + 42, true),
    };
    entries.set(entry.name, entry);
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Bytes of one entry, at most maxBytes after inflating. Throws ZipError when the entry cannot be read safely. */
export function readZipEntry(buf: Uint8Array, entry: ZipEntry, maxBytes: number): Uint8Array {
  if (entry.flags & 1) throw new ZipError("encrypted");
  if (entry.size > maxBytes) throw new ZipError("too large");
  const v = view(buf);
  const at = entry.offset;
  if (at + 30 > buf.length || v.getUint32(at, true) !== LOCAL_HEADER) throw new ZipError("broken entry");
  const start = at + 30 + v.getUint16(at + 26, true) + v.getUint16(at + 28, true);
  const data = buf.subarray(start, start + entry.compressedSize);
  if (start + entry.compressedSize > buf.length) throw new ZipError("truncated");
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new ZipError("unsupported compression");
  try {
    return inflateRawSync(data, { maxOutputLength: maxBytes });
  } catch {
    throw new ZipError("cannot inflate");
  }
}
