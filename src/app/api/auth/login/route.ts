import { z } from "zod";
import { login } from "@/lib/auth/session";

const body = z.object({ login: z.string().min(1).max(64), password: z.string().min(1).max(128) });

/**
 * JSON login for integrations and load tests; sets the same session cookie as the login form.
 * Public by design: brute force is limited per account (lockout by the access policy, src/lib/auth/policy.ts) and every attempt is audited.
 */
export async function POST(request: Request) {
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  const result = await login(parsed.data.login, parsed.data.password);
  if (!result.ok) return Response.json({ error: result.error }, { status: 401 });
  const { id, login: userLogin, fullName, role } = result.user;
  return Response.json({ id, login: userLogin, fullName, role });
}
