"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { audit } from "@/lib/audit";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

export type ActionState = { ok?: string; error?: string };

const PROTECTED = new Set(
  process.env.DEMO_MODE === "true" ? ["admin", "teacher", "student1", "student2", "student3", "student4", "student5"] : [],
);

const createSchema = z.object({
  login: z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,32}$/, "Логин: 3–32 латинских буквы, цифры, _ . -"),
  fullName: z.string().trim().min(3, "Укажите ФИО"),
  role: z.enum(["ADMIN", "TEACHER", "STUDENT"]),
  password: z.string(),
});

export async function createUser(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireUser(["ADMIN"]);
  const parsed = createSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  const problem = passwordProblem(parsed.data.password);
  if (problem) return { error: problem };
  if (await db.user.findUnique({ where: { login: parsed.data.login } })) return { error: "Такой логин уже есть" };

  const user = await db.user.create({
    data: {
      login: parsed.data.login,
      fullName: parsed.data.fullName,
      role: parsed.data.role as Role,
      passwordHash: await hashPassword(parsed.data.password),
    },
  });
  await audit({
    action: "user.create",
    actorId: admin.id,
    actor: admin.login,
    entity: "User",
    entityId: user.id,
    after: { login: user.login, fullName: user.fullName, role: user.role },
  });
  revalidatePath("/admin/users");
  return { ok: `Создан пользователь ${user.login}` };
}

export async function setBlocked(userId: string, blocked: boolean): Promise<ActionState> {
  const admin = await requireUser(["ADMIN"]);
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "Пользователь не найден" };
  if (user.id === admin.id) return { error: "Нельзя заблокировать себя" };
  if (PROTECTED.has(user.login)) return { error: "Демо-учётку на стенде менять нельзя" };

  await db.$transaction([
    db.user.update({ where: { id: userId }, data: { isBlocked: blocked, failedLogins: 0, lockedUntil: null } }),
    ...(blocked ? [db.session.deleteMany({ where: { userId } })] : []),
  ]);
  await audit({
    action: blocked ? "user.block" : "user.unblock",
    actorId: admin.id,
    actor: admin.login,
    entity: "User",
    entityId: user.id,
    before: { isBlocked: user.isBlocked },
    after: { isBlocked: blocked },
  });
  revalidatePath("/admin/users");
  return { ok: blocked ? `${user.login} заблокирован` : `${user.login} разблокирован` };
}

export async function resetPassword(userId: string, password: string): Promise<ActionState> {
  const admin = await requireUser(["ADMIN"]);
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "Пользователь не найден" };
  if (PROTECTED.has(user.login)) return { error: "Демо-учётку на стенде менять нельзя" };
  const problem = passwordProblem(password);
  if (problem) return { error: problem };

  await db.$transaction([
    db.user.update({
      where: { id: userId },
      data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date(), failedLogins: 0, lockedUntil: null },
    }),
    db.session.deleteMany({ where: { userId } }),
  ]);
  await audit({ action: "user.password_reset", actorId: admin.id, actor: admin.login, entity: "User", entityId: user.id });
  revalidatePath("/admin/users");
  return { ok: `Пароль ${user.login} изменён, сессии завершены` };
}
