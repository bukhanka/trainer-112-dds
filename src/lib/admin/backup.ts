import { execFile } from "node:child_process";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { db } from "../db";
import { audit } from "../audit";
import { mirrorMaterials, pruneMaterialMirror } from "../materials/storage";

const run = promisify(execFile);

// Dumps live outside the traced server bundle.
export const BACKUP_DIR = process.env.BACKUP_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "backups");

/**
 * Database dump in pg_dump custom format, plus the files of the library of materials mirrored into
 * BACKUP_DIR/materials (the dump lists them, it does not hold them). Restore: scripts/restore.sh <file> (docs/admin.md).
 */
export async function runBackup(kind: "manual" | "scheduled", actor?: { id: string; login: string }) {
  await mkdir(/*turbopackIgnore: true*/ BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `trainer-${stamp}.dump`;
  const row = await db.backup.create({ data: { kind, fileName, status: "running" } });
  const url = new URL(process.env.DATABASE_URL ?? "");
  url.search = ""; // pg_dump does not accept Prisma's ?schema= parameter
  try {
    await run("pg_dump", ["--format=custom", "--no-owner", `--file=${path.join(BACKUP_DIR, fileName)}`, url.toString()], {
      timeout: 10 * 60_000,
    });
    const { size } = await stat(/*turbopackIgnore: true*/ path.join(BACKUP_DIR, fileName));
    const stored = await db.material.findMany({ select: { storedName: true } });
    await mirrorMaterials(stored.map((m) => m.storedName), BACKUP_DIR);
    await db.backup.update({ where: { id: row.id }, data: { status: "ok", sizeBytes: BigInt(size) } });
    await audit({ action: kind === "manual" ? "backup.manual" : "backup.scheduled", actorId: actor?.id, actor: actor?.login ?? "system", entity: "Backup", entityId: row.id });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err);
    await db.backup.update({ where: { id: row.id }, data: { status: "failed", error: message } });
    await audit({ action: "backup.failed", actor: actor?.login ?? "system", entity: "Backup", entityId: row.id, after: { message } });
  }
  return db.backup.findUniqueOrThrow({ where: { id: row.id } });
}

/**
 * Remove dump files and rows older than keepDays; returns how many of each went. Mirror copies of deleted materials
 * go too once no kept dump can list them (last seen alive by a backup before the cutoff); they count as files.
 */
export async function pruneBackups(keepDays: number): Promise<{ files: number; rows: number }> {
  const cutoff = Date.now() - keepDays * 86_400_000;
  const files = await readdir(/*turbopackIgnore: true*/ BACKUP_DIR).catch(() => [] as string[]);
  let removed = 0;
  for (const file of files.filter((f) => f.endsWith(".dump"))) {
    const full = path.join(/*turbopackIgnore: true*/ BACKUP_DIR, file);
    const { mtimeMs } = await stat(/*turbopackIgnore: true*/ full);
    if (mtimeMs < cutoff) {
      const gone = await unlink(/*turbopackIgnore: true*/ full).then(
        () => true,
        () => false,
      );
      if (gone) removed++;
    }
  }
  const live = new Set((await db.material.findMany({ select: { storedName: true } })).map((m) => m.storedName));
  removed += await pruneMaterialMirror(live, BACKUP_DIR, cutoff);
  const rows = await db.backup.deleteMany({ where: { createdAt: { lt: new Date(cutoff) } } });
  return { files: removed, rows: rows.count };
}
