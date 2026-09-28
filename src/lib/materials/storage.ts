/**
 * Files of the library on disk. Every file lies directly in MATERIALS_DIR under a name the server makes up,
 * «<uuid>.<ext>»: nothing a user types ever becomes a path. A stored name is checked against that pattern and the
 * resolved path must stay inside the folder. In Docker the folder is the volume «materials» (/materials).
 *
 * Backups. The database dump does not hold the files, so every backup also mirrors them into BACKUP_DIR/materials
 * (files never change after upload: a new one is copied, an old one only marked «seen»). The mirror copy of a
 * deleted material stays while a dump that lists it may still exist — keepDays after the last backup that saw it.
 * scripts/restore.sh puts the files back next to the restored database.
 *
 * No Next.js imports: the demo seed and the nightly demo reset use this module outside the server.
 */
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, stat, readdir, unlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";

export const MATERIALS_DIR = process.env.MATERIALS_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "storage", "materials");

const STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{2,5}$/;

export function isStoredName(name: string): boolean {
  return STORED_NAME.test(name);
}

/** Full path of a stored file. Anything but «<uuid>.<ext>», or a path outside the folder, throws. */
export function storedPath(storedName: string, dir = MATERIALS_DIR): string {
  if (!isStoredName(storedName)) throw new Error(`not a stored material name: ${JSON.stringify(storedName.slice(0, 80))}`);
  const root = path.resolve(/*turbopackIgnore: true*/ dir);
  const full = path.resolve(/*turbopackIgnore: true*/ root, storedName);
  if (path.dirname(full) !== root) throw new Error("material path leaves its folder");
  return full;
}

/** Writes a new file under a fresh name and returns that name; never overwrites. */
export async function saveMaterialFile(bytes: Uint8Array, ext: string, dir = MATERIALS_DIR): Promise<string> {
  if (!/^[a-z0-9]{2,5}$/.test(ext)) throw new Error(`bad extension ${JSON.stringify(ext)}`);
  await mkdir(/*turbopackIgnore: true*/ dir, { recursive: true });
  const storedName = `${randomUUID()}.${ext}`;
  await writeFile(/*turbopackIgnore: true*/ storedPath(storedName, dir), bytes, { flag: "wx", mode: 0o644 });
  return storedName;
}

/** Removes a stored file; one that is already gone is fine. */
export async function removeMaterialFile(storedName: string, dir = MATERIALS_DIR): Promise<void> {
  try {
    await unlink(/*turbopackIgnore: true*/ storedPath(storedName, dir));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
}

export const MIRROR_FOLDER = "materials";

/**
 * Copies the library files that the database lists into BACKUP_DIR/materials; a copy that is already there is only
 * touched, so its time says when a backup last saw the file alive. Missing files are counted, not fatal.
 */
export async function mirrorMaterials(storedNames: string[], backupDir: string, dir = MATERIALS_DIR): Promise<{ copied: number; seen: number; missing: number }> {
  const names = storedNames.filter(isStoredName);
  if (!names.length) return { copied: 0, seen: 0, missing: 0 };
  const target = path.join(/*turbopackIgnore: true*/ backupDir, MIRROR_FOLDER);
  await mkdir(/*turbopackIgnore: true*/ target, { recursive: true });
  const now = new Date();
  let copied = 0;
  let seen = 0;
  let missing = 0;
  for (const name of names) {
    const from = storedPath(name, dir);
    const to = storedPath(name, target);
    const source = await stat(/*turbopackIgnore: true*/ from).catch(() => null);
    if (!source) {
      missing++;
      continue;
    }
    const copy = await stat(/*turbopackIgnore: true*/ to).catch(() => null);
    if (copy && copy.size === source.size) {
      await utimes(/*turbopackIgnore: true*/ to, now, now);
      seen++;
    } else {
      await copyFile(/*turbopackIgnore: true*/ from, to);
      copied++;
    }
  }
  return { copied, seen, missing };
}

/** Removes mirror copies of files no row lists any more, last seen alive before the cutoff. Returns how many went. */
export async function pruneMaterialMirror(liveStoredNames: Set<string>, backupDir: string, cutoffMs: number): Promise<number> {
  const target = path.join(/*turbopackIgnore: true*/ backupDir, MIRROR_FOLDER);
  const copies = (await readdir(/*turbopackIgnore: true*/ target).catch(() => [] as string[])).filter(isStoredName);
  let removed = 0;
  for (const name of copies) {
    if (liveStoredNames.has(name)) continue;
    const full = storedPath(name, target);
    const info = await stat(/*turbopackIgnore: true*/ full).catch(() => null);
    if (!info || info.mtimeMs >= cutoffMs) continue;
    if (await unlink(/*turbopackIgnore: true*/ full).then(() => true, () => false)) removed++;
  }
  return removed;
}
