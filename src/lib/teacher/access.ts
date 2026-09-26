/**
 * Access rules of the teacher cabinet.
 *
 * A teacher works only with own lessons and own groups; an administrator sees all of them.
 * Every route handler of /api/teacher/* starts with teacherApi() and then loads rows through
 * the scopes below, so a foreign id simply resolves to «not found».
 */
import type { Prisma } from "@prisma/client";
import { apiUser, type SessionUser } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

export function teacherApi(): Promise<SessionUser | Response> {
  return apiUser(["TEACHER", "ADMIN"]);
}

export function lessonScope(user: SessionUser): Prisma.LessonWhereInput {
  return user.role === "ADMIN" ? {} : { teacherId: user.id };
}

export function groupScope(user: SessionUser): Prisma.GroupWhereInput {
  return user.role === "ADMIN" ? {} : { teacherId: user.id };
}

export function attemptScope(user: SessionUser): Prisma.AttemptWhereInput {
  return user.role === "ADMIN" ? {} : { lesson: { teacherId: user.id } };
}

export function findLesson(user: SessionUser, id: string) {
  return db.lesson.findFirst({ where: { id, ...lessonScope(user) } });
}

export function jsonError(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export function requestIp(request: Request): string | null {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || null;
}

type AuditFields = {
  action: string;
  entity: string;
  entityId: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
};

export function auditBy(user: SessionUser, request: Request, fields: AuditFields): Promise<void> {
  return audit({ ...fields, actorId: user.id, actor: user.login, ip: requestIp(request) });
}

/** Reads a JSON body; returns null for a missing or broken body. */
export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
