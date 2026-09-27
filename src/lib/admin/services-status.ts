/**
 * Live state of the application's services for the administrator's panel (Состояние → Службы): the three
 * switchable ones with what they are doing now, plus the database and the server process, which cannot be
 * stopped from the browser.
 */
import { aiConfig } from "../ai/provider";
import { db } from "../db";
import { getSetting } from "../settings";
import { moscowDay } from "./days";
import { DEMO_OFF_MINUTES, HEARTBEAT_SETTING, readSwitches, type SwitchState } from "./services";
import { readUsage } from "./usage";

/** The scheduler ticks once a minute; three minutes without a tick means it is not running anywhere. */
const HEARTBEAT_STALE_MS = 3 * 60_000;

export type ServicesStatus = {
  at: string;
  demo: boolean;
  demoOffMinutes: number;
  scheduler: SwitchState & {
    heartbeatAt: string | null;
    alive: boolean;
    backupAt: string;
    integrityAt: string;
    resetAt: string | null;
    lastBackup: { at: string; status: string } | null;
  };
  ai: SwitchState & { config: { llm: string; stt: string; tts: string }; today: { calls: number; rules: number; failed: number } };
  ddsFlow: SwitchState & { runningLessons: number; ddsPlaces: number; cardsLastHour: number };
  database: { ok: boolean; ms: number; sizeMb: number | null; connections: number | null; version: string | null };
  server: { pid: number; node: string; uptimeMin: number; memoryMb: number };
};

export async function collectServicesStatus(now = new Date()): Promise<ServicesStatus> {
  const demo = process.env.DEMO_MODE === "true";
  const t0 = Date.now();
  let dbOk = true;
  try {
    await db.$queryRaw`SELECT 1`;
  } catch {
    dbOk = false;
  }
  const ms = Date.now() - t0;
  const server = {
    pid: process.pid,
    node: process.version,
    uptimeMin: Math.round(process.uptime() / 60),
    memoryMb: Math.round(process.memoryUsage().rss / 1e6),
  };
  const off: SwitchState = { on: true, at: null, by: null, until: null, expired: false };
  if (!dbOk) {
    return {
      at: now.toISOString(),
      demo,
      demoOffMinutes: DEMO_OFF_MINUTES,
      scheduler: { ...off, heartbeatAt: null, alive: false, backupAt: "—", integrityAt: "—", resetAt: null, lastBackup: null },
      ai: { ...off, config: aiConfig(), today: { calls: 0, rules: 0, failed: 0 } },
      ddsFlow: { ...off, runningLessons: 0, ddsPlaces: 0, cardsLastHour: 0 },
      database: { ok: false, ms, sizeMb: null, connections: null, version: null },
      server,
    };
  }

  const today = moscowDay(now);
  const hourAgo = new Date(now.getTime() - 3_600_000);
  const [switches, heartbeat, backupAt, integrityAt, resetAt, lastBackup, usage, runningLessons, ddsPlaces, cardsLastHour, pg] = await Promise.all([
    readSwitches(now.getTime()),
    db.systemSetting.findUnique({ where: { key: HEARTBEAT_SETTING } }),
    getSetting("backup.dailyAt", "03:00"),
    getSetting("integrity.dailyAt", "05:00"),
    getSetting("demo.resetAt", "04:30"),
    db.backup.findFirst({ orderBy: { createdAt: "desc" } }),
    readUsage([today]),
    db.lesson.count({ where: { status: "RUNNING" } }),
    db.seat.count({ where: { role: "DDS", lesson: { status: "RUNNING" } } }),
    db.incident.count({ where: { ddsSeatId: { not: null }, createdAt: { gte: hourAgo } } }),
    db.$queryRaw<{ size: bigint; connections: bigint; version: string }[]>`
      SELECT pg_database_size(current_database()) AS size,
        (SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()) AS connections,
        current_setting('server_version') AS version`.catch(() => []),
  ]);
  const beat = heartbeat?.value as { at?: string } | undefined;
  const beatAt = typeof beat?.at === "string" ? beat.at : null;
  const u = usage[today] ?? {};
  return {
    at: now.toISOString(),
    demo,
    demoOffMinutes: DEMO_OFF_MINUTES,
    scheduler: {
      ...switches.scheduler,
      heartbeatAt: beatAt,
      alive: beatAt != null && now.getTime() - Date.parse(beatAt) < HEARTBEAT_STALE_MS,
      backupAt,
      integrityAt,
      resetAt: demo ? resetAt : null,
      lastBackup: lastBackup ? { at: lastBackup.createdAt.toISOString(), status: lastBackup.status } : null,
    },
    ai: {
      ...switches.ai,
      config: aiConfig(),
      today: { calls: (u["ai.chat"] ?? 0) + (u["ai.voice"] ?? 0), rules: u["ai.rules"] ?? 0, failed: u["ai.failed"] ?? 0 },
    },
    ddsFlow: { ...switches.ddsFlow, runningLessons, ddsPlaces, cardsLastHour },
    database: {
      ok: true,
      ms,
      sizeMb: pg[0] ? Math.round(Number(pg[0].size) / 1e6) : null,
      connections: pg[0] ? Number(pg[0].connections) : null,
      version: pg[0]?.version ?? null,
    },
    server,
  };
}
