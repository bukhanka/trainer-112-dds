"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Role } from "@prisma/client";
import { audit } from "@/lib/audit";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { isProtectedDemoLogin } from "@/lib/auth/demo";
import { accessPolicy } from "@/lib/auth/policy";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

export type ActionState = { ok?: string; error?: string };

const createSchema = z.object({
  login: z.string().trim().toLowerCase().regex(/^[a-z0-9_.-]{3,32}$/, "Логин: 3–32 латинских буквы, цифры, _ . -"),
  fullName: z.string().trim().min(3, "Укажите ФИО"),
  role: z.enum(["ADMIN", "TEACHER", "STUDENT"]),
  password: z.string(),
  groupId: z.string().max(40).optional(), // «добавить в группу» for a new student; empty — no group
});

export async function createUser(_prev: ActionState, form: FormData): Promise<ActionState> {
  const admin = await requireUser(["ADMIN"]);
  const parsed = createSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Проверьте поля" };
  const problem = passwordProblem(parsed.data.password, (await accessPolicy()).minPasswordLength);
  if (problem) return { error: problem };
  if (await db.user.findUnique({ where: { login: parsed.data.login } })) return { error: "Такой логин уже есть" };
  const groupId = parsed.data.role === "STUDENT" ? parsed.data.groupId?.trim() : "";
  const group = groupId ? await db.group.findFirst({ where: { id: groupId, archivedAt: null }, select: { id: true, name: true } }) : null;
  if (groupId && !group) return { error: "Группа не найдена или убрана в архив" };

  // The account and its membership are written together: a student never ends up half-created.
  const user = await db.user.create({
    data: {
      login: parsed.data.login,
      fullName: parsed.data.fullName,
      role: parsed.data.role as Role,
      passwordHash: await hashPassword(parsed.data.password),
      ...(group ? { memberships: { create: { groupId: group.id } } } : {}),
    },
  });
  await audit({
    action: "user.create",
    actorId: admin.id,
    actor: admin.login,
    entity: "User",
    entityId: user.id,
    after: { login: user.login, fullName: user.fullName, role: user.role, group: group?.name ?? null },
  });
  if (group) {
    await audit({
      action: "group.member.add",
      actorId: admin.id,
      actor: admin.login,
      entity: "Group",
      entityId: group.id,
      after: { group: group.name, studentId: user.id, student: user.login, fullName: user.fullName },
    });
  }
  revalidatePath("/admin/users");
  revalidatePath("/admin/groups");
  return { ok: `Создан пользователь ${user.login}${group ? ` — в группе «${group.name}»` : ""}` };
}

export async function setBlocked(userId: string, blocked: boolean): Promise<ActionState> {
  const admin = await requireUser(["ADMIN"]);
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "Пользователь не найден" };
  if (user.id === admin.id) return { error: "Нельзя заблокировать себя" };
  if (isProtectedDemoLogin(user.login)) return { error: "Демо-учётку на стенде менять нельзя" };

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
  if (isProtectedDemoLogin(user.login)) return { error: "Демо-учётку на стенде менять нельзя" };
  const problem = passwordProblem(password, (await accessPolicy()).minPasswordLength);
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
