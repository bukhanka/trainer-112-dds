import { describe, expect, it } from "vitest";
import { backupCheck, diskCheck, expectedCounts, migrationCheck, referenceCheck, type BackupRow } from "./integrity";

const now = new Date("2026-09-27T05:00:00+03:00");
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
const ok = (h: number): BackupRow => ({ createdAt: hoursAgo(h), status: "ok", fileName: "trainer-x.dump", sizeBytes: 400_000, error: null });
const dump = { size: 400_000, header: "PGDMP", readable: true };

describe("integrity: migrations", () => {
  it("passes when every shipped migration is applied", () => {
    const res = migrationCheck(["001_init", "002_more"], [
      { name: "001_init", finished: true, rolledBack: false },
      { name: "002_more", finished: true, rolledBack: false },
    ]);
    expect(res).toMatchObject({ code: "migrations", ok: true, detail: "Применены все 2" });
  });

  it("names a pending and a stuck migration", () => {
    const res = migrationCheck(["001_init", "002_more", "003_new"], [
      { name: "001_init", finished: true, rolledBack: false },
      { name: "002_more", finished: false, rolledBack: false },
    ]);
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("не завершена: 002_more");
    expect(res.detail).toContain("не применены (1): 003_new");
  });

  it("does not trust a rolled-back migration and fails without the migrations folder", () => {
    expect(migrationCheck(["001_init"], [{ name: "001_init", finished: true, rolledBack: true }]).ok).toBe(false);
    expect(migrationCheck(null, []).ok).toBe(false);
  });
});

describe("integrity: reference data", () => {
  const files = {
    classifier: { groups: [{}, {}], types: [{ routes: [1, 2, 3] }, { routes: [4] }, {}] },
    services: [{}, {}, {}, {}],
    scenarios: [{}],
  };

  it("counts what the seed loads from data/*.json", () => {
    expect(expectedCounts(files)).toEqual({ groups: 2, types: 3, routes: 4, services: 4, scenarios: 1 });
    expect(expectedCounts({})).toEqual({ groups: null, types: null, routes: null, services: null, scenarios: null });
  });

  it("passes with as many rows as in the files or more", () => {
    const res = referenceCheck(expectedCounts(files), { groups: 2, types: 3, routes: 4, services: 5, scenarios: 1 });
    expect(res.ok).toBe(true);
  });

  it("names every short reference and the missing files", () => {
    const res = referenceCheck({ ...expectedCounts(files), scenarios: null }, { groups: 2, types: 1, routes: 0, services: 4, scenarios: 0 });
    expect(res.ok).toBe(false);
    expect(res.detail).toContain("типы происшествий: 1 из 3");
    expect(res.detail).toContain("правила маршрутизации: 0 из 4");
    expect(res.detail).toContain("нет файла data/scenarios.json");
  });
});

describe("integrity: latest backup", () => {
  it("passes a fresh, non-empty, readable copy", () => {
    expect(backupCheck(ok(3), ok(3), dump, now)).toMatchObject({ ok: true });
    expect(backupCheck(ok(3), ok(3), { ...dump, readable: null }, now).detail).toContain("pg_restore не установлен");
  });

  it("fails without any successful copy", () => {
    expect(backupCheck(null, null, null, now).detail).toContain("ещё нет");
    const failed = { ...ok(1), status: "failed", error: "pg_dump: connection refused" };
    expect(backupCheck(failed, null, null, now).detail).toContain("connection refused");
  });

  it("fails a copy older than 26 hours, a missing, empty or foreign file", () => {
    expect(backupCheck(ok(27), ok(27), dump, now).detail).toContain("27 ч");
    expect(backupCheck(ok(25), ok(25), dump, now).ok).toBe(true);
    expect(backupCheck(ok(1), ok(1), null, now).detail).toContain("не найден");
    expect(backupCheck(ok(1), ok(1), { ...dump, size: 0 }, now).detail).toContain("пустой");
    expect(backupCheck(ok(1), ok(1), { ...dump, header: "hello" }, now).detail).toContain("не похож");
    expect(backupCheck(ok(1), ok(1), { ...dump, readable: false, readError: "bad TOC" }, now).detail).toContain("bad TOC");
  });

  it("reports a failed attempt after the last good copy", () => {
    const res = backupCheck({ ...ok(1), status: "failed" }, ok(5), dump, now);
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/^Последняя попытка/);
  });
});

describe("integrity: disk", () => {
  it("fails below the threshold and when the size is unknown", () => {
    expect(diskCheck(10, 2).ok).toBe(true);
    expect(diskCheck(1.5, 2)).toMatchObject({ ok: false });
    expect(diskCheck(null, 2).ok).toBe(false);
  });
});
