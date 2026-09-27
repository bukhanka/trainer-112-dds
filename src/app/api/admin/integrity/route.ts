import { lastIntegrity, runIntegrityCheck } from "@/lib/admin/integrity";
import { apiUser } from "@/lib/auth/session";

/** The latest integrity check (scheduled or manual). */
export async function GET() {
  const user = await apiUser(["ADMIN"]);
  if (user instanceof Response) return user;
  return Response.json({ report: await lastIntegrity() });
}

/** Runs the integrity check now; read-only apart from storing and journaling its result. */
export async function POST() {
  const user = await apiUser(["ADMIN"]);
  if (user instanceof Response) return user;
  return Response.json({ report: await runIntegrityCheck("manual", user) });
}
