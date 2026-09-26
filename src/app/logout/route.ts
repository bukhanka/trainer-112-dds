import { logout } from "@/lib/auth/session";

export async function POST(request: Request) {
  await logout();
  return Response.redirect(new URL("/login", request.url), 303);
}
