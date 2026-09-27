import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { audit } from "../audit";
import { db } from "../db";
import { getSetting } from "../settings";
import { pruneBackups, runBackup } from "./backup";
import { lastOccurrence, localDay, moscowDay } from "./days";
import { lastIntegrity, runIntegrityCheck } from "./integrity";
import { HEARTBEAT_SETTING, serviceOn, startStoppedServices } from "./services";
import { closeAbandonedPractice } from "../lessons/practice-cleanup";

// Built into the Docker image from prisma/demo-reset.ts; absent in development.
const DEMO_RESET_SCRIPT = path.join(/*turbopackIgnore: true*/ process.cwd(), "dist", "demo-reset.js");

const TICK_MS = 60_000;
/**
 * The nightly demo reset runs only within this many minutes after demo.resetAt: a server restarted during
 * the day must not wipe what the reviewers have made since the morning.
 */
export const DEMO_RESET_WINDOW_MIN = 180;

let started = false;
let lastBackupDay = "";
let lastDemoResetStart = 0;
let lastIntegrityDay = "";
let lastHousekeeping = 0;
let lastPracticeCleanup = 0;

/**
 * Background jobs inside one app process (cluster.cjs gives them to the first worker): daily backup, daily
 * integrity check, hourly cleanup of old backups, journal records and expired sessions, closing abandoned practice
 * every 10 minutes, and — on the public demo stand — the nightly reset. The administrator can pause the jobs (Состояние → Службы); the demo reset still
 * runs on the stand, since it is what starts every stopped service again.
 */
export function startScheduler() {
  if (started || process.env.DISABLE_SCHEDULER === "true") return;
  started = true;
  void beat(false);
  setInterval(() => void tick().catch((err) => console.error("scheduler tick failed", err)), TICK_MS).unref();
}

/** Whether the demo reset belongs to this tick: inside the window after the last «resetAt». */
export function demoResetDue(now: Date, resetAt: string, windowMin = DEMO_RESET_WINDOW_MIN): { due: boolean; start: Date } {
  const start = lastOccurrence(now, resetAt);
  return { due: now.getTime() - start.getTime() < windowMin * 60_000, start };
}

async function beat(paused: boolean) {
  const value = { at: new Date().toISOString(), pid: process.pid, paused } as Prisma.InputJsonValue;
  await db.systemSetting.upsert({ where: { key: HEARTBEAT_SETTING }, update: { value }, create: { key: HEARTBEAT_SETTING, value } }).catch(() => undefined);
}

async function tick() {
  const now = new Date();
  const hhmm = now.toTimeString().slice(0, 5);
  const today = localDay(now);

  if (process.env.DEMO_MODE === "true") await demoStep(now);
  // A stop made on the demo stand ends by itself after a while (src/lib/admin/services.ts).
  await startStoppedServices("timeout", now.getTime());

  const paused = !(await serviceOn("scheduler"));
  await beat(paused);
  if (paused) return;

  const dailyAt = await getSetting("backup.dailyAt", "03:00");
  if (hhmm >= dailyAt && lastBackupDay !== today) {
    const done = await db.backup.findFirst({
      where: { kind: "scheduled", status: "ok", createdAt: { gte: new Date(`${today}T00:00:00`) } },
    });
    lastBackupDay = today;
    if (!done) await runBackup("scheduled");
  }

  const integrityAt = await getSetting("integrity.dailyAt", "05:00");
  if (hhmm >= integrityAt && lastIntegrityDay !== today) {
    lastIntegrityDay = today;
    if ((await lastIntegrity())?.scheduledDay !== today) await runIntegrityCheck("scheduled");
  }

  // Practice nobody works at any more is finished, so it does not hang as a running lesson.
  if (Date.now() - lastPracticeCleanup > 10 * 60_000) {
    lastPracticeCleanup = Date.now();
    const closed = await closeAbandonedPractice(now);
    if (closed) await audit({ action: "system.cleanup", actor: "system", after: { practice: closed } });
  }

  if (Date.now() - lastHousekeeping > 3_600_000) {
    lastHousekeeping = Date.now();
    await housekeeping();
  }
}

/** Old backups, journal records past the retention, expired sessions, old usage counters. */
async function housekeeping() {
  const keepDays = await getSetting("backup.keepDays", 14);
  const backups = await pruneBackups(keepDays);
  // Security journal is kept at least six months whatever the setting says.
  const retentionDays = Math.max(await getSetting("audit.retentionDays", 190), 183);
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000);
  const journal = await db.auditLog.deleteMany({ where: { at: { lt: cutoff } } });
  const sessions = await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  const counters = await db.usageCounter.deleteMany({ where: { day: { lt: moscowDay(cutoff) } } });
  // Expired sessions go every hour; the system journal gets a line only when something kept for long was removed.
  if (backups.files || backups.rows || journal.count || counters.count) {
    await audit({
      action: "system.cleanup",
      actor: "system",
      after: { backupFiles: backups.files, backupRows: backups.rows, journal: journal.count, sessions: sessions.count, counters: counters.count, keepDays, retentionDays },
    });
  }
}

/**
 * Public demo stand: once a night, within the window after demo.resetAt, every stopped service starts, the
 * access policy returns to its defaults and the demo data is rebuilt (dist/demo-reset.js in the Docker image).
 */
async function demoStep(now: Date) {
  const resetAt = await getSetting("demo.resetAt", "04:30");
  const { due, start } = demoResetDue(now, resetAt);
  if (!due || lastDemoResetStart === start.getTime()) return;
  lastDemoResetStart = start.getTime();
  // Already done in this window (the server restarted after it): do not wipe the morning's work again.
  if (await db.auditLog.findFirst({ where: { action: "demo.reset", at: { gte: start } }, select: { id: true } })) return;

  const services = await startStoppedServices("demo-reset", now.getTime());
  const policies = await db.systemSetting.deleteMany({ where: { key: { startsWith: "policy." } } });
  if (services.length || policies.count) {
    await audit({ action: "demo.defaults", actor: "system", after: { services, policies: policies.count } });
  }
  if (!existsSync(/*turbopackIgnore: true*/ DEMO_RESET_SCRIPT)) return;
  execFile("node", [DEMO_RESET_SCRIPT], { timeout: 10 * 60_000 }, (err, stdout, stderr) => {
    if (!err) return console.log(stdout.trim());
    console.error("demo reset failed", err, stderr);
    void audit({ action: "demo.reset.failed", actor: "system", after: { message: `${err.message} ${stderr}`.trim().slice(0, 1000) } });
  });
}
