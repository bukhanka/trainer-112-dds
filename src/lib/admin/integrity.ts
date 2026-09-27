/**
 * Integrity check: is the system whole enough to teach tomorrow? The scheduler runs it every day
 * (setting integrity.dailyAt), the administrator — with a button on the «Состояние» page.
 *
 *   db          the database answers
 *   migrations  every migration shipped with the app is applied, none is stuck half-way
 *   reference   classifier groups and types, routing rules, services and ticket scenarios are all in the
 *               database — no fewer than in data/*.json
 *   backup      the latest successful backup is younger than BACKUP_MAX_AGE_HOURS, not empty and readable
 *               (pg_dump header, and `pg_restore --list` when the tool is installed)
 *   disk        free space on the backup and application disks is above integrity.minFreeGb
 *
 * The result is kept in the setting «integrity.last» (every server process and page sees it) and written to
 * the system journal; a failed check puts a red banner on the administrator's home page.
 */
import { execFile } from "node:child_process";
import { open, readdir, readFile, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Prisma } from "@prisma/client";
import { audit } from "../audit";
import { db } from "../db";
import { formatDateTime } from "../format";
import { getSetting } from "../settings";
import { BACKUP_DIR } from "./backup";
import { localDay } from "./days";

const run = promisify(execFile);

export const BACKUP_MAX_AGE_HOURS = 26;
export const INTEGRITY_SETTING = "integrity.last";

export type CheckCode = "db" | "migrations" | "reference" | "backup" | "disk";
export type Check = { code: CheckCode; title: string; ok: boolean; detail: string };
export type IntegrityReport = {
  at: string;
  ok: boolean;
  trigger: "scheduled" | "manual";
  by: string;
  ms: number;
  checks: Check[];
  /** Local day of the last scheduled run, so that a restart does not repeat it the same day. */
  scheduledDay: string | null;
};

export const CHECK_TITLES: Record<CheckCode, string> = {
  db: "База данных отвечает",
  migrations: "Миграции базы применены",
  reference: "Справочники полные",
  backup: "Свежая читаемая резервная копия",
  disk: "Свободное место на диске",
};

const check = (code: CheckCode, ok: boolean, detail: string): Check => ({ code, title: CHECK_TITLES[code], ok, detail });
const num = (n: number) => n.toLocaleString("ru-RU");
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

// ─── pure verdicts ───────────────────────────────────────────────────────────

export type AppliedMigration = { name: string; finished: boolean; rolledBack: boolean };

/** Migration folders shipped with the app against the rows of _prisma_migrations. */
export function migrationCheck(files: string[] | null, applied: AppliedMigration[]): Check {
  if (!files?.length) return check("migrations", false, "Не найдена папка prisma/migrations — сравнить не с чем");
  const done = new Set(applied.filter((m) => m.finished && !m.rolledBack).map((m) => m.name));
  const stuck = applied.filter((m) => !m.finished && !m.rolledBack).map((m) => m.name);
  const pending = files.filter((f) => !done.has(f) && !stuck.includes(f));
  const problems = [
    ...(stuck.length ? [`не завершена: ${stuck.join(", ")}`] : []),
    ...(pending.length ? [`не применены (${pending.length}): ${pending.slice(0, 3).join(", ")}${pending.length > 3 ? "…" : ""} — выполните prisma migrate deploy`] : []),
  ];
  if (problems.length) return check("migrations", false, problems.join("; "));
  return check("migrations", true, `Применены все ${files.length}`);
}

export type RefKey = "groups" | "types" | "routes" | "services" | "scenarios";
export type RefCounts = Record<RefKey, number>;
export const REF_LABELS: Record<RefKey, string> = {
  groups: "группы классификатора",
  types: "типы происшествий",
  routes: "правила маршрутизации",
  services: "службы",
  scenarios: "сценарии из билетов и инструкции",
};
export const REF_FILES: Record<RefKey, string> = {
  groups: "classifier.json",
  types: "classifier.json",
  routes: "classifier.json",
  services: "services.json",
  scenarios: "scenarios.json",
};

/** How many rows the seed loads from the delivered files (prisma/seed-reference.ts). */
export function expectedCounts(files: { classifier?: unknown; services?: unknown; scenarios?: unknown }): Record<RefKey, number | null> {
  const cls = files.classifier as { groups?: unknown[]; types?: { routes?: unknown[] }[] } | undefined;
  const list = (v: unknown) => (Array.isArray(v) ? v.length : null);
  return {
    groups: list(cls?.groups),
    types: list(cls?.types),
    routes: Array.isArray(cls?.types) ? cls.types.reduce((sum, t) => sum + (Array.isArray(t.routes) ? t.routes.length : 0), 0) : null,
    services: list(files.services),
    scenarios: list(files.scenarios),
  };
}

/** Reference rows in the database against the delivered files: fewer rows than in a file is a problem. */
export function referenceCheck(expected: Record<RefKey, number | null>, actual: RefCounts): Check {
  const keys = Object.keys(REF_LABELS) as RefKey[];
  const noFile = [...new Set(keys.filter((k) => expected[k] == null).map((k) => REF_FILES[k]))];
  const short = keys.filter((k) => expected[k] != null && actual[k] < (expected[k] as number));
  const problems = [
    ...short.map((k) => `${REF_LABELS[k]}: ${num(actual[k])} из ${num(expected[k] as number)}`),
    ...(noFile.length ? [`нет файла data/${noFile.join(", data/")} — сравнить не с чем`] : []),
  ];
  if (problems.length) {
    return check("reference", false, `${problems.join("; ")}${short.length ? ". Загрузите заново: node dist/seed.js (в Docker) или pnpm db:seed" : ""}`);
  }
  return check("reference", true, keys.map((k) => `${REF_LABELS[k]} ${num(actual[k])}`).join(" · ") + " — не меньше, чем в data/*.json");
}

export type BackupRow = { createdAt: Date; status: string; fileName: string | null; sizeBytes: bigint | number | null; error: string | null };
/** null — the file is not on disk; readable null — pg_restore is not installed, only the header was read. */
export type DumpFile = { size: number; header: string; readable: boolean | null; readError?: string } | null;

export function backupCheck(latest: BackupRow | null, lastOk: BackupRow | null, file: DumpFile, now: Date, maxAgeHours = BACKUP_MAX_AGE_HOURS): Check {
  if (!lastOk) {
    return check(
      "backup",
      false,
      latest?.status === "failed"
        ? `Успешных копий нет, последняя попытка не удалась: ${latest.error ?? "ошибка"}`
        : "Резервных копий ещё нет — сделайте копию в разделе «Резервные копии»",
    );
  }
  const problems: string[] = [];
  if (latest && latest.status === "failed" && latest.createdAt > lastOk.createdAt) {
    problems.push(`последняя попытка ${formatDateTime(latest.createdAt)} не удалась`);
  }
  const ageHours = (now.getTime() - lastOk.createdAt.getTime()) / 3_600_000;
  if (ageHours > maxAgeHours) problems.push(`последней успешной копии ${Math.floor(ageHours)} ч — больше ${maxAgeHours} ч`);
  if (!file) problems.push(`файл ${lastOk.fileName ?? "копии"} не найден в каталоге копий`);
  else if (file.size === 0) problems.push("файл копии пустой");
  else if (file.header !== "PGDMP") problems.push("файл не похож на копию pg_dump");
  else if (file.readable === false) problems.push(`pg_restore не читает файл${file.readError ? `: ${file.readError}` : ""}`);
  if (problems.length) return check("backup", false, capitalize(problems.join("; ")));
  const size = file ? `${(file.size / 1e6).toFixed(1)} МБ` : "";
  const how = file?.readable === null ? "заголовок в порядке (pg_restore не установлен)" : "читается pg_restore";
  return check("backup", true, `${formatDateTime(lastOk.createdAt)}, ${size}, ${how}`);
}

export function diskCheck(freeGb: number | null, minGb: number): Check {
  if (freeGb == null) return check("disk", false, "Не удалось узнать свободное место");
  if (freeGb < minGb) return check("disk", false, `Свободно ${freeGb.toFixed(1)} ГБ — меньше порога ${minGb} ГБ: удалите старые копии или расширьте диск`);
  return check("disk", true, `Свободно ${freeGb.toFixed(1)} ГБ, порог ${minGb} ГБ`);
}

// ─── running the check ───────────────────────────────────────────────────────

const ROOT = /*turbopackIgnore: true*/ process.cwd();

async function readJson(name: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(ROOT, "data", name), "utf8"));
  } catch {
    return undefined;
  }
}

async function migrationFolders(): Promise<string[] | null> {
  try {
    const entries = await readdir(/*turbopackIgnore: true*/ path.join(ROOT, "prisma", "migrations"), { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  } catch {
    return null;
  }
}

async function inspectDump(fileName: string): Promise<DumpFile> {
  const file = path.join(/*turbopackIgnore: true*/ BACKUP_DIR, path.basename(fileName));
  let size: number;
  try {
    size = (await stat(/*turbopackIgnore: true*/ file)).size;
  } catch {
    return null;
  }
  let header = "";
  try {
    const handle = await open(/*turbopackIgnore: true*/ file, "r");
    const buf = Buffer.alloc(5);
    await handle.read(buf, 0, 5, 0);
    await handle.close();
    header = buf.toString("latin1");
  } catch {
    /* unreadable: reported by the header check */
  }
  if (!size || header !== "PGDMP") return { size, header, readable: false };
  try {
    await run("pg_restore", ["--list", file], { timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    return { size, header, readable: true };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { size, header, readable: null };
    return { size, header, readable: false, readError: (err instanceof Error ? err.message : String(err)).slice(0, 200) };
  }
}

async function freeGb(): Promise<number | null> {
  const dirs = [...new Set([BACKUP_DIR, ROOT])];
  const free = await Promise.all(
    dirs.map((d) =>
      statfs(/*turbopackIgnore: true*/ d)
        .then((s) => (s.bavail * s.bsize) / 1e9)
        .catch(() => null),
    ),
  );
  const known = free.filter((f): f is number => f != null);
  return known.length ? Math.min(...known) : null;
}

async function collectChecks(now: Date): Promise<Check[]> {
  const checks: Check[] = [];
  const t0 = Date.now();
  let dbOk = true;
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (err) {
    dbOk = false;
    checks.push(check("db", false, `Нет связи с базой: ${(err instanceof Error ? err.message : String(err)).slice(0, 160)}`));
  }
  if (dbOk) checks.push(check("db", true, `Ответ за ${Date.now() - t0} мс`));

  const [folders, classifier, services, scenarioFile, cardErrors, minGb, free] = await Promise.all([
    migrationFolders(),
    readJson("classifier.json"),
    readJson("services.json"),
    readJson("scenarios.json"),
    readJson("scenarios-card-errors.json"),
    getSetting("integrity.minFreeGb", 2).catch(() => 2),
    freeGb(),
  ]);
  // The seed loads the ticket variants with an error in the card too (prisma/seed-reference.ts).
  const scenarios = Array.isArray(scenarioFile) ? [...scenarioFile, ...(Array.isArray(cardErrors) ? cardErrors : [])] : scenarioFile;

  if (!dbOk) {
    for (const code of ["migrations", "reference", "backup"] as const) checks.push(check(code, false, "Не проверено: база недоступна"));
  } else {
    const applied = await db
      .$queryRaw<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }[]>`
        SELECT migration_name, finished_at, rolled_back_at FROM "_prisma_migrations"`
      .catch(() => null);
    checks.push(
      applied
        ? migrationCheck(folders, applied.map((m) => ({ name: m.migration_name, finished: m.finished_at != null, rolledBack: m.rolled_back_at != null })))
        : check("migrations", false, "Нет таблицы _prisma_migrations: база создана не миграциями"),
    );

    const [groups, types, routes, serviceRows, ticketScenarios] = await Promise.all([
      db.incidentGroup.count(),
      db.incidentType.count(),
      db.route.count(),
      db.service.count(),
      // The delivered library: ticket situations and the instruction's tasks (both come from data/scenarios.json).
      db.scenario.count({ where: { source: { in: ["ticket", "instruction"] } } }),
    ]);
    checks.push(referenceCheck(expectedCounts({ classifier, services, scenarios }), { groups, types, routes, services: serviceRows, scenarios: ticketScenarios }));

    const [latest, lastOk] = await Promise.all([
      db.backup.findFirst({ where: { status: { not: "running" } }, orderBy: { createdAt: "desc" } }),
      db.backup.findFirst({ where: { status: "ok" }, orderBy: { createdAt: "desc" } }),
    ]);
    checks.push(backupCheck(latest, lastOk, lastOk?.fileName ? await inspectDump(lastOk.fileName) : null, now));
  }
  checks.push(diskCheck(free, Number(minGb) || 2));
  return checks;
}

export async function lastIntegrity(): Promise<IntegrityReport | null> {
  const row = await db.systemSetting.findUnique({ where: { key: INTEGRITY_SETTING } }).catch(() => null);
  const value = row?.value as IntegrityReport | undefined;
  return value && Array.isArray(value.checks) ? value : null;
}

const holder = globalThis as unknown as { __integrityRun?: Promise<IntegrityReport> | null };

/**
 * Runs the check, stores the result and writes it to the system journal. A second request while a check
 * is running in this process gets the same result instead of a second run.
 */
export function runIntegrityCheck(trigger: "scheduled" | "manual", actor?: { id: string; login: string }): Promise<IntegrityReport> {
  holder.__integrityRun ??= doRun(trigger, actor).finally(() => (holder.__integrityRun = null));
  return holder.__integrityRun;
}

async function doRun(trigger: "scheduled" | "manual", actor?: { id: string; login: string }): Promise<IntegrityReport> {
  const started = Date.now();
  const now = new Date();
  const checks = await collectChecks(now);
  const previous = await lastIntegrity();
  const report: IntegrityReport = {
    at: now.toISOString(),
    ok: checks.every((c) => c.ok),
    trigger,
    by: actor?.login ?? "system",
    ms: Date.now() - started,
    checks,
    scheduledDay: trigger === "scheduled" ? localDay(now) : (previous?.scheduledDay ?? null),
  };
  const value = report as unknown as Prisma.InputJsonValue;
  await db.systemSetting
    .upsert({ where: { key: INTEGRITY_SETTING }, update: { value }, create: { key: INTEGRITY_SETTING, value } })
    .catch((err) => console.error("integrity: result not saved", err instanceof Error ? err.message : err));
  const failed = checks.filter((c) => !c.ok);
  await audit({
    action: report.ok ? "system.integrity.ok" : "system.integrity.fail",
    actorId: actor?.id,
    actor: report.by,
    entity: "Integrity",
    entityId: trigger,
    after: { trigger, checks: checks.length, failed: failed.map((c) => `${c.title}: ${c.detail}`) },
  });
  if (!report.ok) console.error(`integrity check: ${failed.length} problem(s) — ${failed.map((c) => c.title).join("; ")}`);
  return report;
}
