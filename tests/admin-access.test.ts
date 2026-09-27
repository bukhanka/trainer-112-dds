import { beforeEach, describe, expect, it, vi } from "vitest";

// Every administrator API refuses anyone but an administrator; nothing is switched or run for them.
const state = vi.hoisted(() => ({
  user: null as null | { id: string; login: string; fullName: string; role: "ADMIN" | "TEACHER" | "STUDENT" },
  switched: [] as unknown[],
  checks: 0,
}));

vi.mock("@/lib/auth/session", () => ({
  apiUser: async (roles?: string[]) => {
    if (!state.user) return Response.json({ error: "unauthorized" }, { status: 401 });
    return roles && !roles.includes(state.user.role) ? Response.json({ error: "forbidden" }, { status: 403 }) : state.user;
  },
}));
vi.mock("@/lib/admin/services-status", () => ({ collectServicesStatus: async () => ({ ok: true }) }));
vi.mock("@/lib/admin/services", () => ({
  SERVICE_KEYS: ["scheduler", "ai", "ddsFlow"],
  SERVICE_LABELS: { scheduler: "Планировщик", ai: "Модели ИИ", ddsFlow: "Поток карточек ДДС" },
  setService: async (...args: unknown[]) => void state.switched.push(args),
}));
vi.mock("@/lib/db", () => ({
  db: {
    auditLog: {
      findMany: async () => [
        { at: new Date("2026-09-27T09:00:00Z"), actor: '=HYPERLINK("http://evil","x")', action: "auth.login.fail", entity: null, entityId: null, before: null, after: { reason: "no_user" }, ip: "10.0.0.9" },
        { at: new Date("2026-09-27T09:05:00Z"), actor: "admin", action: "service.stop", entity: "Service", entityId: "ai", before: { on: true }, after: { on: false }, ip: null },
      ],
    },
  },
}));

const services = await import("@/app/api/admin/services/route");
const exportCsv = (await import("@/app/api/admin/audit/export/route")).GET;
const post = (body: unknown) => new Request("http://x/api/admin/services", { method: "POST", body: JSON.stringify(body) });

const people = {
  anonymous: null,
  student: { id: "s1", login: "student1", fullName: "Иванов", role: "STUDENT" as const },
  teacher: { id: "t1", login: "teacher", fullName: "Смирнова", role: "TEACHER" as const },
};

describe("administrator API", () => {
  beforeEach(() => {
    state.switched = [];
    state.checks = 0;
  });

  for (const [who, user] of Object.entries(people)) {
    it(`is closed to ${who}`, async () => {
      state.user = user;
      const expected = user ? 403 : 401;
      expect((await services.GET()).status).toBe(expected);
      expect((await services.POST(post({ service: "ai", on: false }))).status).toBe(expected);
      expect((await exportCsv(new Request("http://x/api/admin/audit/export?scope=system"))).status).toBe(expected);
      expect(state.switched).toEqual([]);
      expect(state.checks).toBe(0);
    });
  }

  it("lets an administrator switch a known service only", async () => {
    state.user = { id: "a1", login: "admin", fullName: "Админ", role: "ADMIN" };
    expect((await services.POST(post({ service: "database", on: false }))).status).toBe(400);
    expect((await services.POST(post({ service: "ai", on: "no" }))).status).toBe(400);
    expect((await services.POST(post({ service: "ai", on: false }))).status).toBe(200);
    expect(state.switched).toEqual([["ai", false, state.user, null]]);
  });
});
