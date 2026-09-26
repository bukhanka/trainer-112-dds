import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import type { SessionUser } from "@/lib/auth/session";
import { apiUser, SESSION_COOKIE } from "@/lib/auth/session";
import { seatForUser, type SeatAccess } from "./seat";

/**
 * Key of the current login session for «Тренировка без занятия»: several people may use one demo account
 * at once, each gets their own practice. A salted hash — it cannot be matched to the stored session.
 */
export async function practiceKey(): Promise<string> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  return createHash("sha256").update(`dds-practice:${token}`).digest("hex").slice(0, 24);
}

export type DdsContext = { user: SessionUser; access: SeatAccess };

/**
 * Every /api/dds route starts here: a logged-in user and the ДДС place they may see.
 * Writes need the owner's place in a running lesson; teachers and admins only watch.
 */
export async function ddsContext(request: Request, opts: { write?: boolean } = {}): Promise<DdsContext | Response> {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const seatId = new URL(request.url).searchParams.get("seat");
  const access = await seatForUser(user, seatId, await practiceKey());
  if (!access) return Response.json({ error: "no_seat", message: "Нет места ДДС" }, { status: 404 });
  if (opts.write && access.readOnly) {
    return Response.json({ error: "read_only", message: "Только просмотр: занятие завершено или место не ваше" }, { status: 403 });
  }
  return { user, access };
}

export function badRequest(message: string, status = 400): Response {
  return Response.json({ error: "bad_request", message }, { status });
}
