import { NextResponse, type NextRequest } from "next/server";

// Cheap gate: anonymous visitors go to the login screen. Real checks (expiry, role, block)
// happen on the server in requireUser()/apiUser() against the session table.
export function proxy(request: NextRequest) {
  if (request.cookies.has("sid")) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: ["/((?!login|api/health|api/auth/login|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|webp|ico|mp3|wav)$).*)"],
};
