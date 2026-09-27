import os from "node:os";
import { statfs } from "node:fs/promises";
import { aiConfig } from "../ai/provider";
import { db } from "../db";

export type Health = {
  at: string;
  db: { ok: boolean; ms: number };
  ai: ReturnType<typeof aiConfig>;
  load: number[];
  cpus: number;
  memory: { usedMb: number; totalMb: number; processMb: number };
  disk: { freeGb: number; totalGb: number } | null;
  uptimeMin: number;
  activeSessions: number;
  runningLessons: number;
  errorsLastHour: number;
  lastBackup: { at: string; status: string } | null;
};

export async function collectHealth(): Promise<Health> {
  const started = Date.now();
  let dbOk = true;
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }
  const dbMs = Date.now() - started;
  const hourAgo = new Date(Date.now() - 3_600_000);
  const [activeSessions, runningLessons, errorsLastHour, lastBackup] = dbOk
    ? await Promise.all([
        db.session.count({ where: { expiresAt: { gt: new Date() } } }),
        db.lesson.count({ where: { status: "RUNNING" } }),
        db.auditLog.count({ where: { action: "system.error", at: { gte: hourAgo } } }),
        db.backup.findFirst({ orderBy: { createdAt: "desc" } }),
      ])
    : [0, 0, 0, null];
  const disk = await statfs(process.cwd())
    .then((s) => ({ freeGb: +((s.bavail * s.bsize) / 1e9).toFixed(1), totalGb: +((s.blocks * s.bsize) / 1e9).toFixed(1) }))
    .catch(() => null);
  return {
    at: new Date().toISOString(),
    db: { ok: dbOk, ms: dbMs },
    ai: aiConfig(),
    load: os.loadavg().map((n) => +n.toFixed(2)),
    cpus: os.cpus().length,
    memory: {
      usedMb: Math.round((os.totalmem() - os.freemem()) / 1e6),
      totalMb: Math.round(os.totalmem() / 1e6),
      processMb: Math.round(process.memoryUsage().rss / 1e6),
    },
    disk,
    uptimeMin: Math.round(process.uptime() / 60),
    activeSessions,
    runningLessons,
    errorsLastHour,
    lastBackup: lastBackup ? { at: lastBackup.createdAt.toISOString(), status: lastBackup.status } : null,
  };
}
