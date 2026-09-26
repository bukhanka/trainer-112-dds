import type { Prisma } from "@prisma/client";
import { db } from "./db";

type AuditInput = {
  action: string;
  actorId?: string | null;
  actor?: string | null;
  entity?: string;
  entityId?: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ip?: string | null;
};

/** Append a record to the audit journal. Never throws: auditing must not break the user action. */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({ data: { ...input, actorId: input.actorId ?? null } });
  } catch (err) {
    console.error("audit write failed", input.action, err);
  }
}
