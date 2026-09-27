import { beforeEach, describe, expect, it, vi } from "vitest";

// Login with a stricter access policy: lockout after 3 failures for 7 minutes, sessions of 2 hours.
const state = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  updates: [] as Record<string, unknown>[],
  sessions: [] as Record<string, unknown>[],
  cookie: null as null | { expires: Date },
  policy: { minPasswordLength: 8, maxFailedLogins: 3, lockMinutes: 7, sessionHours: 2 },
}));

vi.mock("../db", () => ({
  db: {
    user: {
      findUnique: async () => state.user,
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.updates.push(data);
        Object.assign(state.user!, data);
        return state.user;
      },
    },
    session: { create: async ({ data }: { data: Record<string, unknown> }) => void state.sessions.push(data) },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  },
}));
vi.mock("../audit", () => ({ audit: async () => {} }));
vi.mock("./policy", () => ({ accessPolicy: async () => state.policy }));
vi.mock("./password", () => ({ verifyPassword: async (plain: string) => plain === "Right2026" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ set: (_name: string, _value: string, opts: { expires: Date }) => void (state.cookie = opts) }),
}));

const { login } = await import("./session");

beforeEach(() => {
  state.user = { id: "u1", login: "petrov", fullName: "Петров", role: "STUDENT", isBlocked: false, lockedUntil: null, failedLogins: 0, passwordHash: "x" };
  state.updates = [];
  state.sessions = [];
  vi.unstubAllEnvs();
});

describe("login follows the access policy", () => {
  it("locks the account after the policy's number of failures for the policy's minutes", async () => {
    await login("petrov", "wrong");
    await login("petrov", "wrong");
    expect(state.updates.at(-1)).toMatchObject({ failedLogins: 2 });
    const before = Date.now();
    await login("petrov", "wrong");
    const lockedUntil = state.updates.at(-1)!.lockedUntil as Date;
    expect(lockedUntil.getTime() - before).toBeGreaterThanOrEqual(7 * 60_000 - 1000);
    expect(lockedUntil.getTime() - before).toBeLessThan(8 * 60_000);
    expect((await login("petrov", "Right2026")).ok).toBe(false); // locked now
  });

  it("never locks a demo account on the demo stand", async () => {
    vi.stubEnv("DEMO_MODE", "true");
    state.user = { ...state.user!, login: "student1" };
    for (let i = 0; i < 5; i++) await login("student1", "wrong");
    expect(state.updates.every((u) => u.lockedUntil == null)).toBe(true);
    expect((await login("student1", "Right2026")).ok).toBe(true);
  });

  it("issues a session for the policy's lifetime", async () => {
    const before = Date.now();
    expect((await login("petrov", "Right2026")).ok).toBe(true);
    const expires = state.sessions[0].expiresAt as Date;
    expect(Math.round((expires.getTime() - before) / 3_600_000)).toBe(2);
    expect(state.cookie?.expires).toEqual(expires);
  });
});
