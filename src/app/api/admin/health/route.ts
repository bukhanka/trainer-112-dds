import { collectHealth } from "@/lib/admin/health";
import { apiUser } from "@/lib/auth/session";

export async function GET() {
  const user = await apiUser(["ADMIN"]);
  if (user instanceof Response) return user;
  return Response.json(await collectHealth());
}
