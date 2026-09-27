import { describe, expect, it } from "vitest";
import { auditWhere, readFilter } from "./audit-query";
import { isProblem, systemDetails, systemWhere } from "./system-log";

describe("system journal", () => {
  it("is a view of system event codes, one kind at a time if asked", () => {
    const all = systemWhere().OR as { action: { startsWith: string } }[];
    expect(all.map((c) => c.action.startsWith)).toEqual(expect.arrayContaining(["system.error", "backup.", "service.", "demo.", "system.integrity"]));
    expect(systemWhere("service")).toEqual({ OR: [{ action: { startsWith: "service." } }] });
  });

  it("reads scope and kind from the page address, ignoring unknown kinds and malformed dates", () => {
    expect(readFilter({ scope: "system", kind: "backup", from: "2026-09-01" })).toMatchObject({ scope: "system", kind: "backup", from: "2026-09-01" });
    expect(readFilter({ scope: "system", kind: "drop table" })).not.toHaveProperty("kind");
    expect(readFilter({ from: "yesterday" }).from).toBeUndefined();
    expect(auditWhere({ scope: "system", kind: "error" })).toMatchObject({ OR: [{ action: { startsWith: "system.error" } }] });
    expect(auditWhere({})).toEqual({});
  });

  it("writes events in plain words", () => {
    expect(systemDetails({ action: "system.error", entity: "route", entityId: "GET /api/x", after: { message: "boom" } })).toBe("GET /api/x — boom");
    expect(systemDetails({ action: "service.stop", entity: "Service", entityId: "ai", after: { on: false } })).toBe("Модели ИИ — остановлено");
    expect(systemDetails({ action: "service.auto_start", entity: "Service", entityId: "ddsFlow", after: { reason: "demo-reset" } })).toContain("ночной сброс");
    expect(systemDetails({ action: "system.integrity.fail", entity: "Integrity", entityId: "manual", after: { checks: 5, failed: ["Диск: мало места"] } })).toBe("1 из 5: Диск: мало места");
    expect(isProblem("system.integrity.fail")).toBe(true);
    expect(isProblem("backup.failed")).toBe(true);
    expect(isProblem("service.start")).toBe(false);
  });
});
