import { execFile } from "node:child_process";
import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { db } from "../db";
import { audit } from "../audit";

const run = promisify(execFile);

// Dumps live outside the traced server bundle.
export const BACKUP_DIR = process.env.BACKUP_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "backups");

/** Database dump in pg_dump custom format. Restore: scripts/restore.sh <file> (see docs/admin.md). */
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
    await db.backup.update({ where: { id: row.id }, data: { status: "ok", sizeBytes: BigInt(size) } });
    await audit({ action: `backup.${kind}`, actorId: actor?.id, actor: actor?.login ?? "system", entity: "Backup", entityId: row.id });
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 500) : String(err);
    await db.backup.update({ where: { id: row.id }, data: { status: "failed", error: message } });
    await audit({ action: "backup.failed", actor: actor?.login ?? "system", entity: "Backup", entityId: row.id, after: { message } });
  }
  return db.backup.findUniqueOrThrow({ where: { id: row.id } });
}

/** Remove dump files and rows older than keepDays. */
export async function pruneBackups(keepDays: number) {
  const cutoff = Date.now() - keepDays * 86_400_000;
  const files = await readdir(/*turbopackIgnore: true*/ BACKUP_DIR).catch(() => [] as string[]);
  for (const file of files.filter((f) => f.endsWith(".dump"))) {
    const full = path.join(/*turbopackIgnore: true*/ BACKUP_DIR, file);
    const { mtimeMs } = await stat(/*turbopackIgnore: true*/ full);
    if (mtimeMs < cutoff) await unlink(/*turbopackIgnore: true*/ full).catch(() => undefined);
  }
  await db.backup.deleteMany({ where: { createdAt: { lt: new Date(cutoff) } } });
}
