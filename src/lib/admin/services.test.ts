import { afterEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ rows: new Map<string, unknown>(), audit: [] as Record<string, unknown>[] }));

vi.mock("../db", () => ({
  db: {
    systemSetting: {
      findMany: async ({ where }: { where: { key: { in: string[] } } }) =>
        [...store.rows].filter(([key]) => where.key.in.includes(key)).map(([key, value]) => ({ key, value })),
      findUnique: async ({ where }: { where: { key: string } }) => (store.rows.has(where.key) ? { key: where.key, value: store.rows.get(where.key) } : null),
      upsert: async ({ where, create }: { where: { key: string }; create: { value: unknown } }) => void store.rows.set(where.key, create.value),
      update: async ({ where, data }: { where: { key: string }; data: { value: unknown } }) => void store.rows.set(where.key, data.value),
    },
  },
}));
vi.mock("../audit", () => ({ audit: async (entry: Record<string, unknown>) => void store.audit.push(entry) }));

const { DEMO_OFF_MINUTES, effectiveSwitch, serviceOn, setService, startStoppedServices, switchRecord } = await import("./services");

const admin = { id: "u-admin", login: "admin" };
const T = Date.parse("2026-09-27T10:00:00Z");

afterEach(() => {
  store.rows.clear();
  store.audit.length = 0;
  vi.unstubAllEnvs();
});

describe("service switches", () => {
  it("counts a service without a record, or with a broken one, as running", () => {
    expect(effectiveSwitch(undefined, T)).toMatchObject({ on: true, expired: false });
    expect(effectiveSwitch({ nonsense: 1 }, T).on).toBe(true);
  });

  it("keeps an administrator's stop until it is started again, away from the demo stand", () => {
    const rec = switchRecord(false, "admin", T, false);
    expect(rec.until).toBeNull();
    expect(effectiveSwitch(rec, T + 30 * 86_400_000)).toMatchObject({ on: false, by: "admin" });
  });

  it("on the demo stand a stop ends by itself after DEMO_OFF_MINUTES", () => {
    const rec = switchRecord(false, "admin", T, true);
    expect(Date.parse(rec.until!)).toBe(T + DEMO_OFF_MINUTES * 60_000);
    expect(effectiveSwitch(rec, T + DEMO_OFF_MINUTES * 60_000 - 1).on).toBe(false);
    expect(effectiveSwitch(rec, T + DEMO_OFF_MINUTES * 60_000)).toMatchObject({ on: true, expired: true });
  });

  it("journals a stop with who and until when, and ignores a repeated click", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    expect((await setService("ai", false, admin, "10.0.0.1")).changed).toBe(true);
    expect((await setService("ai", false, admin)).changed).toBe(false);
    expect(store.audit).toHaveLength(1);
    expect(store.audit[0]).toMatchObject({ action: "service.stop", actor: "admin", entity: "Service", entityId: "ai", ip: "10.0.0.1", before: { on: true } });
    expect((store.audit[0].after as { until?: string }).until).toBeTruthy();
    expect(await serviceOn("ai")).toBe(false); // this process sees its own switch at once
    await setService("ai", true, admin);
    expect(store.audit[1]).toMatchObject({ action: "service.start", after: { on: true } });
    expect(await serviceOn("ai")).toBe(true);
  });

  it("the system starts a demo stop whose time is up, and the nightly reset starts every stop", async () => {
    store.rows.set("service.ddsFlow", switchRecord(false, "admin", T, true));
    store.rows.set("service.scheduler", switchRecord(false, "admin", T, false));
    expect(await startStoppedServices("timeout", T + 60_000)).toEqual([]);
    expect(await startStoppedServices("timeout", T + DEMO_OFF_MINUTES * 60_000)).toEqual(["ddsFlow"]);
    expect(store.audit.at(-1)).toMatchObject({ action: "service.auto_start", actor: "system", entityId: "ddsFlow", after: { reason: "timeout" } });
    expect(await startStoppedServices("demo-reset", T + 60_000)).toEqual(["scheduler"]);
    expect(effectiveSwitch(store.rows.get("service.scheduler"), T).on).toBe(true);
  });
});
