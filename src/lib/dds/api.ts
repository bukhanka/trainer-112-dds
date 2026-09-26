import type { SessionUser } from "@/lib/auth/session";
import { apiUser } from "@/lib/auth/session";
import { seatForUser, type SeatAccess } from "./seat";

export type DdsContext = { user: SessionUser; access: SeatAccess };

/**
 * Every /api/dds route starts here: a logged-in user and the ДДС place they may see.
 * Writes need the owner's place in a running lesson; teachers and admins only watch.
 */
export async function ddsContext(request: Request, opts: { write?: boolean } = {}): Promise<DdsContext | Response> {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const seatId = new URL(request.url).searchParams.get("seat");
  const access = await seatForUser(user, seatId);
  if (!access) return Response.json({ error: "no_seat", message: "Нет места ДДС" }, { status: 404 });
  if (opts.write && access.readOnly) {
    return Response.json({ error: "read_only", message: "Только просмотр: занятие завершено или место не ваше" }, { status: 403 });
  }
  return { user, access };
}

export function badRequest(message: string, status = 400): Response {
  return Response.json({ error: "bad_request", message }, { status });
}
