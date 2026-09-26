/**
 * The login session of the current request. Practice without a lesson belongs to a session, not
 * only to an account: on the demo stand several reviewers sign in with the same demo account at once,
 * and one reviewer's practice must not show up on another's screen.
 */
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { SESSION_COOKIE } from "@/lib/auth/session";
import { db } from "@/lib/db";

export async function currentSessionId(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  // Same token hash as the session table stores (src/lib/auth/session.ts).
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const session = await db.session.findUnique({ where: { tokenHash }, select: { id: true } });
  return session?.id ?? null;
}
