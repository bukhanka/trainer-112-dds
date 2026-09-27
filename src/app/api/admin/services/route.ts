import { z } from "zod";
import { collectServicesStatus } from "@/lib/admin/services-status";
import { SERVICE_KEYS, setService } from "@/lib/admin/services";
import { apiUser } from "@/lib/auth/session";
import { requestIp } from "@/lib/teacher/access";

/** Live state of the services for the administrator's panel, polled every few seconds. */
export async function GET() {
  const user = await apiUser(["ADMIN"]);
  if (user instanceof Response) return user;
  return Response.json(await collectServicesStatus());
}

const body = z.object({ service: z.enum(SERVICE_KEYS), on: z.boolean() });

/** Stops or starts a service; every change is journaled. Returns the new live state. */
export async function POST(request: Request) {
  const user = await apiUser(["ADMIN"]);
  if (user instanceof Response) return user;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Неизвестная служба или действие" }, { status: 400 });
  await setService(parsed.data.service, parsed.data.on, user, requestIp(request));
  return Response.json(await collectServicesStatus());
}
