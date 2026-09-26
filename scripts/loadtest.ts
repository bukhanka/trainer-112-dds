/**
 * Load test: N virtual users log in and poll the pages and APIs a class uses, for D seconds.
 * Reports latency percentiles and errors against the ТЗ targets (100 users, response ≤ 2 s).
 *
 *   pnpm exec tsx scripts/loadtest.ts --base http://localhost:3000 --users 100 --duration 60 \
 *     --paths /student,/api/dds/feed
 *   pnpm exec tsx scripts/loadtest.ts --users 30 --setup dds --think 1000 --paths /api/dds/state,/api/dds/feed
 *                                                          # a class of ДДС places, each with its own card flow
 *   pnpm exec tsx scripts/loadtest.ts --db-writes 5000      # database insert throughput (rows/s)
 *
 * Virtual users reuse the demo student accounts, each with its own session.
 */
import { PrismaClient } from "@prisma/client";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1] ?? "");

const BASE = args.get("base") ?? "http://localhost:3100";
const USERS = Number(args.get("users") ?? 100);
const DURATION_S = Number(args.get("duration") ?? 60);
const THINK_MS = Number(args.get("think") ?? 1000);
const PATHS = (args.get("paths") ?? "/student,/api/voice/capabilities").split(",").filter(Boolean);
// --setup dds|op112: each virtual user first starts its own practice place, like a pupil at the workstation.
const SETUP = args.get("setup");
const TARGET_MS = 2000;

type Sample = { path: string; ms: number; ok: boolean };

function pct(sorted: number[], p: number) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function loginCookie(n: number): Promise<string> {
  const login = `student${(n % 5) + 1}`;
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ login, password: process.env.LOADTEST_PASSWORD ?? "Student2026" }),
  });
  if (!res.ok) throw new Error(`login ${login}: ${res.status}`);
  const cookie = res.headers.get("set-cookie")?.split(";")[0];
  if (!cookie) throw new Error("no session cookie");
  return cookie;
}

async function virtualUser(n: number, until: number, samples: Sample[]) {
  const cookie = await loginCookie(n);
  if (SETUP === "dds" || SETUP === "op112") {
    const path = SETUP === "dds" ? "/api/dds/practice" : "/api/op112/training";
    const res = await fetch(`${BASE}${path}`, { method: "POST", headers: { cookie, "Content-Type": "application/json" }, body: "{}" });
    await res.arrayBuffer();
  }
  await new Promise((r) => setTimeout(r, Math.random() * THINK_MS)); // spread the start
  while (Date.now() < until) {
    for (const path of PATHS) {
      const t = performance.now();
      let ok = false;
      try {
        const res = await fetch(`${BASE}${path}`, { headers: { cookie }, redirect: "manual" });
        await res.arrayBuffer();
        ok = res.status < 400;
      } catch {
        ok = false;
      }
      samples.push({ path, ms: performance.now() - t, ok });
    }
    await new Promise((r) => setTimeout(r, THINK_MS));
  }
}

async function httpLoad() {
  const samples: Sample[] = [];
  const started = Date.now();
  const until = started + DURATION_S * 1000;
  console.log(`${USERS} users × ${PATHS.join(", ")} for ${DURATION_S} s against ${BASE}`);
  await Promise.all(Array.from({ length: USERS }, (_, i) => virtualUser(i, until, samples)));
  const seconds = (Date.now() - started) / 1000;

  const rows = [...new Set(samples.map((s) => s.path)), "ВСЕГО"].map((path) => {
    const list = path === "ВСЕГО" ? samples : samples.filter((s) => s.path === path);
    const ms = list.map((s) => s.ms).sort((a, b) => a - b);
    const errors = list.filter((s) => !s.ok).length;
    return { path, n: list.length, rps: +(list.length / seconds).toFixed(1), p50: Math.round(pct(ms, 50)), p95: Math.round(pct(ms, 95)), p99: Math.round(pct(ms, 99)), max: Math.round(ms.at(-1) ?? 0), errors };
  });
  console.table(rows);
  const total = rows.at(-1)!;
  const pass = total.p95 <= TARGET_MS && total.errors === 0;
  console.log(`${pass ? "OK" : "FAIL"}: p95 ${total.p95} ms (цель ≤ ${TARGET_MS} мс), ошибок ${total.errors}`);
  process.exitCode = pass ? 0 : 1;
}

async function dbWrites(count: number) {
  const db = new PrismaClient();
  const batch = 50;
  const started = performance.now();
  for (let done = 0; done < count; done += batch) {
    await Promise.all(
      Array.from({ length: Math.min(batch, count - done) }, (_, i) =>
        db.auditLog.create({ data: { action: "loadtest.write", actor: "loadtest", after: { i: done + i } } }),
      ),
    );
  }
  const seconds = (performance.now() - started) / 1000;
  console.log(`${count} записей за ${seconds.toFixed(1)} с → ${Math.round(count / seconds)} записей/с (цель ≥ 100)`);
  await db.auditLog.deleteMany({ where: { action: "loadtest.write" } });
  await db.$disconnect();
}

const writes = args.get("db-writes");
(writes ? dbWrites(Number(writes)) : httpLoad()).catch((err) => {
  console.error(err);
  process.exit(1);
});
