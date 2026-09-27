import { createHash, randomBytes } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import type { Role, User } from "@prisma/client";
import { db } from "../db";
import { audit } from "../audit";
import { isProtectedDemoLogin } from "./demo";
import { verifyPassword } from "./password";
import { accessPolicy } from "./policy";

export const SESSION_COOKIE = "sid";
const TOUCH_EVERY_MS = 5 * 60 * 1000;

export type SessionUser = Pick<User, "id" | "login" | "fullName" | "role">;

const HOME: Record<Role, string> = { ADMIN: "/admin", TEACHER: "/teacher", STUDENT: "/student" };

export function homeFor(role: Role): string {
  return HOME[role];
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function requestMeta() {
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
  const secure = h.get("x-forwarded-proto") === "https" || process.env.COOKIE_SECURE === "true";
  return { ip, userAgent: h.get("user-agent"), secure };
}

export type LoginResult = { ok: true; user: SessionUser } | { ok: false; error: string };

export async function login(loginName: string, password: string): Promise<LoginResult> {
  const meta = await requestMeta();
  const user = await db.user.findUnique({ where: { login: loginName.trim().toLowerCase() } });
  const fail = "Неверный логин или пароль";

  if (!user) {
    await audit({ action: "auth.login.fail", actor: loginName, ip: meta.ip, after: { reason: "no_user" } });
    return { ok: false, error: fail };
  }
  if (user.isBlocked) {
    await audit({ action: "auth.login.blocked", actorId: user.id, actor: user.login, ip: meta.ip });
    return { ok: false, error: "Учётная запись заблокирована. Обратитесь к администратору" };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    await audit({ action: "auth.login.locked", actorId: user.id, actor: user.login, ip: meta.ip });
    return { ok: false, error: "Слишком много неудачных попыток. Попробуйте позже" };
  }

  // Lockout and session lifetime follow the access policy in force (Настройки → Политики доступа).
  const policy = await accessPolicy();
  if (!(await verifyPassword(password, user.passwordHash))) {
    const failed = user.failedLogins + 1;
    const lock = failed >= policy.maxFailedLogins && !isProtectedDemoLogin(user.login);
    await db.user.update({
      where: { id: user.id },
      data: {
        failedLogins: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + policy.lockMinutes * 60_000) : user.lockedUntil,
      },
    });
    await audit({
      action: lock ? "auth.lockout" : "auth.login.fail",
      actorId: user.id,
      actor: user.login,
      ip: meta.ip,
      after: { failed },
    });
    return { ok: false, error: fail };
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + policy.sessionHours * 3_600_000);
  await db.$transaction([
    db.session.create({
      data: { tokenHash: hashToken(token), userId: user.id, expiresAt, ip: meta.ip, userAgent: meta.userAgent },
    }),
    db.user.update({ where: { id: user.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } }),
  ]);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: meta.secure,
    path: "/",
    expires: expiresAt,
  });
  await audit({ action: "auth.login.ok", actorId: user.id, actor: user.login, ip: meta.ip });
  return { ok: true, user: { id: user.id, login: user.login, fullName: user.fullName, role: user.role } };
}

export async function logout(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    const session = await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
    if (session) {
      await db.session.delete({ where: { id: session.id } });
      await audit({ action: "auth.logout", actorId: session.userId, actor: session.user.login });
    }
  }
  store.delete(SESSION_COOKIE);
}

/** Current user or null. Expired sessions and blocked users are rejected on every request. */
export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { id: true, login: true, fullName: true, role: true, isBlocked: true } } },
  });
  if (!session || session.expiresAt < new Date() || session.user.isBlocked) return null;

  if (Date.now() - session.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  const { id, login, fullName, role } = session.user;
  return { id, login, fullName, role };
}

/** For pages and server actions: redirect to login when anonymous, to own home when the role does not fit. */
export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect(homeFor(user.role));
  return user;
}

/** For route handlers: returns the user or a ready 401/403 response. */
export async function apiUser(roles?: Role[]): Promise<SessionUser | Response> {
  const user = await currentUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (roles && !roles.includes(user.role)) return Response.json({ error: "forbidden" }, { status: 403 });
  return user;
}
