/**
 * Services of the application an administrator can stop and start from the browser:
 *
 *   scheduler — backups, integrity check, journal and backup cleanup (src/lib/admin/scheduler.ts)
 *   ai        — language model, speech recognition and synthesis; switched off, the rules and the browser's
 *               voices do the work, as in a setup without models (src/lib/ai/provider.ts)
 *   ddsFlow   — new cards for the ДДС places of every running lesson (src/lib/flow/dds-flow.ts)
 *
 * A switch is a SystemSetting row «service.<key>», so every server process sees the same state; a process
 * keeps its copy for SWITCH_TTL_MS, so a switch takes effect everywhere within a few seconds.
 *
 * Public demo stand (DEMO_MODE=true): a stopped service starts again by itself after DEMO_OFF_MINUTES, and the
 * nightly demo reset starts everything — one reviewer cannot leave the stand stopped for the others.
 */
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit";

export const SERVICE_KEYS = ["scheduler", "ai", "ddsFlow"] as const;
export type ServiceKey = (typeof SERVICE_KEYS)[number];

export const SERVICE_LABELS: Record<ServiceKey, string> = {
  scheduler: "Планировщик",
  ai: "Модели ИИ",
  ddsFlow: "Поток карточек ДДС",
};

export const DEMO_OFF_MINUTES = 15;
/** Written by the scheduler every tick, so the panel shows whether it is alive in some server process. */
export const HEARTBEAT_SETTING = "scheduler.heartbeat";
const SWITCH_TTL_MS = 3000;

/** As stored: who switched and when; `until` — when a stopped service starts by itself (demo stand). */
export type SwitchRecord = { on: boolean; at?: string; by?: string; until?: string | null };

/** As it applies now. `expired` — stopped, but its `until` has passed: it counts as running again. */
export type SwitchState = { on: boolean; at: string | null; by: string | null; until: string | null; expired: boolean };

export const settingKey = (key: ServiceKey) => `service.${key}`;
const isDemo = () => process.env.DEMO_MODE === "true";

function readRecord(value: unknown): SwitchRecord | null {
  if (!value || typeof value !== "object" || typeof (value as SwitchRecord).on !== "boolean") return null;
  return value as SwitchRecord;
}

/** The state that applies at `now`. No record — running (a fresh install has everything on). */
export function effectiveSwitch(value: unknown, now: number = Date.now()): SwitchState {
  const r = readRecord(value);
  if (!r) return { on: true, at: null, by: null, until: null, expired: false };
  const base = { at: r.at ?? null, by: r.by ?? null, until: r.on ? null : (r.until ?? null) };
  if (r.on) return { ...base, on: true, expired: false };
  const expired = base.until != null && Date.parse(base.until) <= now;
  return { ...base, on: expired, expired };
}

/** The record to store for a switch made now. On the demo stand a stop carries its own end. */
export function switchRecord(on: boolean, by: string, now: number, demo: boolean): SwitchRecord {
  const at = new Date(now).toISOString();
  if (on) return { on, at, by };
  return { on, at, by, until: demo ? new Date(now + DEMO_OFF_MINUTES * 60_000).toISOString() : null };
}

// ─── per-process copy ────────────────────────────────────────────────────────

type Cache = { at: number; values: Partial<Record<ServiceKey, unknown>>; loading: Promise<void> | null; synced: boolean };
// One copy per process, shared by every server bundle (instrumentation, pages, route handlers).
const holder = globalThis as unknown as { __serviceSwitches?: Cache };
const cache = (): Cache => (holder.__serviceSwitches ??= { at: 0, values: {}, loading: null, synced: false });

async function load(c: Cache): Promise<void> {
  try {
    const rows = await db.systemSetting.findMany({ where: { key: { in: SERVICE_KEYS.map(settingKey) } } });
    c.values = Object.fromEntries(rows.map((r) => [r.key.slice("service.".length), r.value]));
  } catch (err) {
    console.error("service switches: read failed, keeping the last known state", err instanceof Error ? err.message : err);
  }
  c.at = Date.now();
}

function refresh(): Promise<void> {
  const c = cache();
  if (!c.loading) c.loading = load(c).finally(() => (c.loading = null));
  return c.loading;
}

/** Whether a service runs now; reads the database at most once per SWITCH_TTL_MS per process. */
export async function serviceOn(key: ServiceKey): Promise<boolean> {
  if (Date.now() - cache().at > SWITCH_TTL_MS) await refresh();
  return effectiveSwitch(cache().values[key]).on;
}

/**
 * The same for code that cannot wait (model gates): answers from this process's copy, which
 * startServiceSync() keeps at most a few seconds old in a server process. Outside a server (scripts,
 * tests) the copy is filled only by serviceOn() and never makes a request on its own.
 */
export function serviceOnNow(key: ServiceKey): boolean {
  const c = cache();
  if (c.synced && Date.now() - c.at > SWITCH_TTL_MS) void refresh();
  return effectiveSwitch(c.values[key]).on;
}

/** Keeps this process's copy fresh. Called once per server process from instrumentation. */
export function startServiceSync(): void {
  const c = cache();
  if (c.synced) return;
  c.synced = true;
  void refresh();
  setInterval(() => void refresh(), 5000).unref();
}

// ─── reading and switching ───────────────────────────────────────────────────

/** Fresh from the database, for the administrator's panel. */
export async function readSwitches(now = Date.now()): Promise<Record<ServiceKey, SwitchState>> {
  const rows = await db.systemSetting.findMany({ where: { key: { in: SERVICE_KEYS.map(settingKey) } } });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return Object.fromEntries(SERVICE_KEYS.map((k) => [k, effectiveSwitch(byKey.get(settingKey(k)), now)])) as Record<ServiceKey, SwitchState>;
}

export type Actor = { id: string; login: string };

/**
 * Stops or starts a service and writes it to the journal. A request for the state that already applies
 * changes nothing and is not journaled (a double click).
 */
export async function setService(key: ServiceKey, on: boolean, actor: Actor, ip: string | null = null): Promise<{ changed: boolean; state: SwitchState }> {
  const now = Date.now();
  const row = await db.systemSetting.findUnique({ where: { key: settingKey(key) } });
  const before = effectiveSwitch(row?.value, now);
  if (before.on === on) return { changed: false, state: before };
  const record = switchRecord(on, actor.login, now, isDemo());
  await db.systemSetting.upsert({
    where: { key: settingKey(key) },
    update: { value: record as Prisma.InputJsonValue, updatedById: actor.id },
    create: { key: settingKey(key), value: record as Prisma.InputJsonValue, updatedById: actor.id },
  });
  cache().values[key] = record; // this process at once, the others within SWITCH_TTL_MS
  await audit({
    action: on ? "service.start" : "service.stop",
    actorId: actor.id,
    actor: actor.login,
    entity: "Service",
    entityId: key,
    before: { on: before.on },
    after: { on, service: SERVICE_LABELS[key], ...(record.until ? { until: record.until } : {}) },
    ip,
  });
  return { changed: true, state: effectiveSwitch(record, now) };
}

/**
 * Starts the stopped services by the system: `timeout` — a demo-stand stop whose time is up; `demo-reset` — the
 * nightly reset of the demo stand, which starts everything. Returns the keys started.
 */
export async function startStoppedServices(reason: "timeout" | "demo-reset", now = Date.now()): Promise<ServiceKey[]> {
  const rows = await db.systemSetting.findMany({ where: { key: { in: SERVICE_KEYS.map(settingKey) } } });
  const started: ServiceKey[] = [];
  for (const row of rows) {
    const key = row.key.slice("service.".length) as ServiceKey;
    const r = readRecord(row.value);
    if (!r || r.on) continue;
    if (reason === "timeout" && !effectiveSwitch(r, now).expired) continue;
    const record: SwitchRecord = { on: true, at: new Date(now).toISOString(), by: "system" };
    await db.systemSetting.update({ where: { key: row.key }, data: { value: record as Prisma.InputJsonValue, updatedById: null } });
    cache().values[key] = record;
    await audit({
      action: "service.auto_start",
      actor: "system",
      entity: "Service",
      entityId: key,
      before: { on: false, by: r.by ?? null, at: r.at ?? null },
      after: { on: true, service: SERVICE_LABELS[key], reason },
    });
    started.push(key);
  }
  return started;
}
