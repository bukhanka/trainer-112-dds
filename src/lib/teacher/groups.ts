/**
 * Groups of students. A teacher creates and keeps own groups; an administrator keeps any group and
 * names its teacher. A group is always looked up through groupScope(user), so another teacher's group
 * answers «не найдено», exactly like a missing one.
 *
 *   members — only accounts with the STUDENT role; a student may be in several groups;
 *   removal — the student also leaves the group's draft lessons; a running or finished lesson keeps
 *             the place, so the work already done stays in the results;
 *   archive — a finished course: the group leaves the lesson form and the forecasts, its history stays.
 */
import type { Group, Prisma } from "@prisma/client";
import { z } from "zod";
import { isProtectedDemoGroup, isProtectedDemoLogin } from "@/lib/auth/demo";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { groupScope } from "./access";

export const GROUP_NAME_MAX = 80;
const DEMO_LOCK = "Демо-группу на стенде менять нельзя: создайте свою группу и работайте с ней.";
export const GROUP_ARCHIVED = "Группа в архиве: верните её в разделе «Группы» или выберите другую";
export const GROUP_HANDED_OVER = "Группы занятия больше нет среди ваших — её передали другому преподавателю. Выберите свою группу в «Изменить».";

/** A lesson's group must still be the teacher's and active to start the lesson or run it again. */
export async function lessonGroupProblem(user: SessionUser, groupId: string | null): Promise<string | null> {
  if (!groupId) return null;
  const group = await findGroup(user, groupId);
  if (!group) return GROUP_HANDED_OVER;
  return group.archivedAt ? GROUP_ARCHIVED : null;
}
const ARCHIVED = "Группа в архиве: верните её из архива, чтобы менять состав.";

export type GroupResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

const refuse = (error: string, status = 400) => ({ ok: false as const, error, status });

const createSchema = z.object({ name: z.string().max(400), teacherId: z.string().max(40).nullish() });
const updateSchema = z.object({
  name: z.string().max(400).optional(),
  teacherId: z.string().max(40).nullable().optional(),
  archived: z.boolean().optional(),
});
const memberSchema = z.object({ userId: z.string().min(1).max(40) });

/** «  Группа   № 2 » → «Группа № 2», or the reason when it is too short or too long. */
export function normalizeGroupName(raw: string): { name: string } | { error: string } {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length < 2) return { error: "Введите название группы — не короче 2 символов" };
  if (name.length > GROUP_NAME_MAX) return { error: `Название группы — не длиннее ${GROUP_NAME_MAX} символов` };
  return { name };
}

export function findGroup(user: SessionUser, id: string) {
  return db.group.findFirst({ where: { id, ...groupScope(user) } });
}

/** Two active groups of one teacher with the same name would be confused in the lesson form. */
async function nameTaken(teacherId: string | null, name: string, exceptId?: string): Promise<boolean> {
  const clash = await db.group.findFirst({
    where: { teacherId, archivedAt: null, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true },
  });
  return !!clash;
}

/** A teacher always owns what they create; an administrator names an active teacher or nobody. */
async function ownerFor(user: SessionUser, requested: string | null | undefined): Promise<GroupResult<string | null>> {
  if (user.role !== "ADMIN") return { ok: true, data: user.id };
  if (!requested) return { ok: true, data: null };
  const teacher = await db.user.findFirst({ where: { id: requested, role: "TEACHER", isBlocked: false }, select: { id: true } });
  return teacher ? { ok: true, data: teacher.id } : refuse("Преподаватель не найден", 404);
}

export async function createGroup(user: SessionUser, raw: unknown): Promise<GroupResult<Group>> {
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) return refuse("Введите название группы");
  const named = normalizeGroupName(parsed.data.name);
  if ("error" in named) return refuse(named.error);
  const owner = await ownerFor(user, parsed.data.teacherId);
  if (!owner.ok) return owner;
  if (await nameTaken(owner.data, named.name)) return refuse(`Группа «${named.name}» уже есть`, 409);
  const group = await db.group.create({ data: { name: named.name, teacherId: owner.data } });
  return { ok: true, data: group };
}

export type GroupChange = { before: Group; after: Group; changed: boolean };

/** Rename, archive / restore; the teacher of a group is changed by an administrator only. */
export async function updateGroup(user: SessionUser, id: string, raw: unknown, now = new Date()): Promise<GroupResult<GroupChange>> {
  const parsed = updateSchema.safeParse(raw);
  if (!parsed.success) return refuse("Неверный запрос");
  const input = parsed.data;
  const group = await findGroup(user, id);
  if (!group) return refuse("Группа не найдена", 404);

  const data: Prisma.GroupUncheckedUpdateManyInput = {};
  if (input.name !== undefined) {
    const named = normalizeGroupName(input.name);
    if ("error" in named) return refuse(named.error);
    if (named.name !== group.name) data.name = named.name;
  }
  if (input.teacherId !== undefined) {
    if (user.role !== "ADMIN") return refuse("Преподавателя группы назначает администратор", 403);
    const owner = await ownerFor(user, input.teacherId);
    if (!owner.ok) return owner;
    if (owner.data !== group.teacherId) data.teacherId = owner.data;
  }
  if (input.archived !== undefined && input.archived !== !!group.archivedAt) data.archivedAt = input.archived ? now : null;
  if (!Object.keys(data).length) return { ok: true, data: { before: group, after: group, changed: false } };
  if (isProtectedDemoGroup(group.name)) return refuse(DEMO_LOCK, 403);

  const name = (data.name as string | undefined) ?? group.name;
  const teacherId = data.teacherId !== undefined ? (data.teacherId as string | null) : group.teacherId;
  const active = data.archivedAt !== undefined ? data.archivedAt === null : !group.archivedAt;
  if (active && (await nameTaken(teacherId, name, group.id))) {
    return refuse(`У преподавателя уже есть группа «${name}» — сначала переименуйте одну из них`, 409);
  }

  // The scope again in the write: the group may have been handed to another teacher a moment ago.
  const moved = await db.group.updateMany({ where: { id, ...groupScope(user) }, data });
  if (!moved.count) return refuse("Группа не найдена", 404);
  const after = await db.group.findFirst({ where: { id } });
  return after ? { ok: true, data: { before: group, after, changed: true } } : refuse("Группа не найдена", 404);
}

export type MemberChange = { group: Group; student: { id: string; fullName: string; login: string } };

export async function addMember(user: SessionUser, groupId: string, raw: unknown): Promise<GroupResult<MemberChange & { added: boolean }>> {
  const parsed = memberSchema.safeParse(raw);
  if (!parsed.success) return refuse("Выберите ученика");
  const group = await findGroup(user, groupId);
  if (!group) return refuse("Группа не найдена", 404);
  if (group.archivedAt) return refuse(ARCHIVED, 409);
  const student = await db.user.findFirst({
    where: { id: parsed.data.userId, role: "STUDENT" },
    select: { id: true, fullName: true, login: true, isBlocked: true },
  });
  if (!student) return refuse("Ученик не найден", 404);
  if (student.isBlocked) return refuse(`Учётная запись заблокирована: ${student.fullName}`, 409);
  const who = { id: student.id, fullName: student.fullName, login: student.login };

  if (await db.groupMember.findFirst({ where: { groupId: group.id, userId: student.id } })) {
    return { ok: true, data: { group, student: who, added: false } };
  }
  // Two teachers' clicks at once: the second one finds the row and changes nothing.
  await db.groupMember.upsert({
    where: { groupId_userId: { groupId: group.id, userId: student.id } },
    update: {},
    create: { groupId: group.id, userId: student.id },
  });
  return { ok: true, data: { group, student: who, added: true } };
}

export async function removeMember(user: SessionUser, groupId: string, userId: string): Promise<GroupResult<MemberChange & { seatsRemoved: number }>> {
  const group = await findGroup(user, groupId);
  if (!group) return refuse("Группа не найдена", 404);
  if (group.archivedAt) return refuse(ARCHIVED, 409);
  const member = await db.groupMember.findFirst({
    where: { groupId: group.id, userId },
    select: { user: { select: { id: true, fullName: true, login: true } } },
  });
  if (!member) return refuse("Этого ученика нет в группе", 404);
  if (isProtectedDemoGroup(group.name) && isProtectedDemoLogin(member.user.login)) return refuse(DEMO_LOCK, 403);

  const seatsRemoved = await db.$transaction(async (tx) => {
    await tx.groupMember.deleteMany({ where: { groupId: group.id, userId } });
    // A draft lesson of the group must not start with someone who has left it.
    const seats = await tx.seat.deleteMany({ where: { studentId: userId, lesson: { groupId: group.id, status: "DRAFT" } } });
    return seats.count;
  });
  return { ok: true, data: { group, student: member.user, seatsRemoved } };
}

export type StudentOption = {
  id: string;
  fullName: string;
  login: string;
  /** Not in any active group: this is who waits to be added. */
  noGroup: boolean;
  /** Names of the viewer's own active groups the student is in (never another teacher's). */
  groups: string[];
};

const SEARCH_LIMIT = 30;

/** Students for the «Добавить ученика» picker: active STUDENT accounts, not yet in the group, those without a group first. */
export async function searchStudents(user: SessionUser, opts: { q?: string | null; groupId?: string | null }): Promise<GroupResult<StudentOption[]>> {
  let groupId: string | null = null;
  if (opts.groupId) {
    const group = await findGroup(user, opts.groupId);
    if (!group) return refuse("Группа не найдена", 404);
    groupId = group.id;
  }
  const q = (opts.q ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  const where: Prisma.UserWhereInput = { role: "STUDENT", isBlocked: false };
  if (q) where.OR = [{ fullName: { contains: q, mode: "insensitive" } }, { login: { contains: q, mode: "insensitive" } }];
  const rows = await db.user.findMany({
    where,
    orderBy: { fullName: "asc" },
    take: 300,
    select: {
      id: true,
      fullName: true,
      login: true,
      memberships: { select: { group: { select: { id: true, name: true, teacherId: true, archivedAt: true } } } },
    },
  });
  const own = (g: { teacherId: string | null }) => user.role === "ADMIN" || g.teacherId === user.id;
  const list = rows
    .filter((r) => !groupId || !r.memberships.some((m) => m.group.id === groupId))
    .map((r) => {
      const active = r.memberships.map((m) => m.group).filter((g) => !g.archivedAt);
      return {
        id: r.id,
        fullName: r.fullName,
        login: r.login,
        noGroup: active.length === 0,
        groups: active
          .filter(own)
          .map((g) => g.name)
          .sort((a, b) => a.localeCompare(b, "ru")),
      };
    })
    .sort((a, b) => Number(b.noGroup) - Number(a.noGroup) || a.fullName.localeCompare(b.fullName, "ru"));
  return { ok: true, data: list.slice(0, SEARCH_LIMIT) };
}

/** Compact form for the audit journal. */
export function groupSnapshot(g: Pick<Group, "name" | "teacherId" | "archivedAt">) {
  return { name: g.name, teacherId: g.teacherId, archivedAt: g.archivedAt?.toISOString() ?? null };
}
