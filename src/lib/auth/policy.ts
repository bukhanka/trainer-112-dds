/**
 * Access policy: password length, lockout after failed logins, session lifetime. The administrator edits it in
 * Настройки → Политики доступа within safe bounds; without a saved value the .env value (or the built-in
 * default) applies. Every value is clamped on read, so a row edited by hand cannot leave the bounds either.
 *
 * Public demo stand (DEMO_MODE=true): a session lives at least DEMO_MIN_SESSION_HOURS, the demo accounts are
 * never locked out (src/lib/auth/demo.ts), a password rule applies only to new passwords, and the nightly demo
 * reset returns the defaults — no policy can lock the reviewers out.
 */
import { db } from "../db";

export type AccessPolicy = {
  minPasswordLength: number;
  maxFailedLogins: number;
  lockMinutes: number;
  sessionHours: number;
};

export type PolicyField = {
  key: keyof AccessPolicy;
  label: string;
  unit: string;
  min: number;
  max: number;
  /** .env variable with the default, if the install has one. */
  env?: string;
  fallback: number;
};

export const DEMO_MIN_SESSION_HOURS = 4;

export const POLICY_FIELDS: PolicyField[] = [
  { key: "minPasswordLength", label: "Минимальная длина пароля", unit: "символов", min: 8, max: 32, fallback: 8 },
  { key: "maxFailedLogins", label: "Неудачных попыток входа до блокировки", unit: "попыток", min: 3, max: 20, env: "MAX_FAILED_LOGINS", fallback: 5 },
  { key: "lockMinutes", label: "Блокировка после перебора пароля", unit: "мин", min: 1, max: 1440, env: "LOCK_MINUTES", fallback: 15 },
  { key: "sessionHours", label: "Срок сессии", unit: "ч", min: 1, max: 72, env: "SESSION_HOURS", fallback: 10 },
];

export const policySettingKey = (key: keyof AccessPolicy) => `policy.${key}`;

export function policyBounds(field: PolicyField, demo: boolean): { min: number; max: number } {
  const min = demo && field.key === "sessionHours" ? Math.max(field.min, DEMO_MIN_SESSION_HOURS) : field.min;
  return { min, max: field.max };
}

/** A whole number within the bounds, or null for anything that is not a number. */
export function clampPolicyValue(field: PolicyField, raw: unknown, demo: boolean): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return null;
  const { min, max } = policyBounds(field, demo);
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** The value without a saved setting: from .env when set, otherwise built in; clamped. */
export function defaultPolicyValue(field: PolicyField, env: Record<string, string | undefined>, demo: boolean): number {
  const fromEnv = field.env ? clampPolicyValue(field, env[field.env], demo) : null;
  return fromEnv ?? (clampPolicyValue(field, field.fallback, demo) as number);
}

/** Saved settings over the defaults. `saved` is keyed by setting key («policy.sessionHours»). */
export function resolvePolicy(saved: Record<string, unknown>, env: Record<string, string | undefined>, demo: boolean): AccessPolicy {
  const out = {} as AccessPolicy;
  for (const field of POLICY_FIELDS) {
    out[field.key] = clampPolicyValue(field, saved[policySettingKey(field.key)], demo) ?? defaultPolicyValue(field, env, demo);
  }
  return out;
}

export const isDemoStand = () => process.env.DEMO_MODE === "true";

/** The policy in force; read on every login and password change (a single small query). */
export async function accessPolicy(): Promise<AccessPolicy> {
  const rows = await db.systemSetting.findMany({ where: { key: { in: POLICY_FIELDS.map((f) => policySettingKey(f.key)) } } });
  return resolvePolicy(Object.fromEntries(rows.map((r) => [r.key, r.value])), process.env, isDemoStand());
}
