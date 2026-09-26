import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "../db";
import { getSetting } from "../settings";
import { pruneBackups, runBackup } from "./backup";

// Built into the Docker image from prisma/demo-reset.ts; absent in development.
const DEMO_RESET_SCRIPT = path.join(/*turbopackIgnore: true*/ process.cwd(), "dist", "demo-reset.js");

const TICK_MS = 60_000;
let started = false;
let lastBackupDay = "";
let lastDemoResetDay = "";
let lastHousekeeping = 0;

/** Background jobs inside the app process: daily backup, backup rotation, audit retention. */
export function startScheduler() {
  if (started || process.env.DISABLE_SCHEDULER === "true") return;
  started = true;
  setInterval(() => void tick().catch((err) => console.error("scheduler tick failed", err)), TICK_MS).unref();
}

async function tick() {
  const now = new Date();
  const dailyAt = await getSetting("backup.dailyAt", "03:00");
  const hhmm = now.toTimeString().slice(0, 5);
  const today = now.toISOString().slice(0, 10);
  if (hhmm >= dailyAt && lastBackupDay !== today) {
    const done = await db.backup.findFirst({
      where: { kind: "scheduled", status: "ok", createdAt: { gte: new Date(`${today}T00:00:00`) } },
    });
    lastBackupDay = today;
    if (!done) await runBackup("scheduled");
  }

  if (process.env.DEMO_MODE === "true" && lastDemoResetDay !== today) {
    const resetAt = await getSetting("demo.resetAt", "04:30");
    if (hhmm >= resetAt) {
      lastDemoResetDay = today;
      if (existsSync(/*turbopackIgnore: true*/ DEMO_RESET_SCRIPT)) {
        execFile("node", [DEMO_RESET_SCRIPT], { timeout: 10 * 60_000 }, (err, stdout, stderr) => {
          if (err) console.error("demo reset failed", err, stderr);
          else console.log(stdout.trim());
        });
      }
    }
  }

  if (Date.now() - lastHousekeeping > 3_600_000) {
    lastHousekeeping = Date.now();
    await pruneBackups(await getSetting("backup.keepDays", 14));
    // Security journal is kept at least six months whatever the setting says.
    const retentionDays = Math.max(await getSetting("audit.retentionDays", 190), 183);
    await db.auditLog.deleteMany({ where: { at: { lt: new Date(Date.now() - retentionDays * 86_400_000) } } });
    await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  }
}
