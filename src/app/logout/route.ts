import { logout } from "@/lib/auth/session";
import { closeSessionPractice } from "@/lib/lessons/practice-cleanup";
import { currentSessionId } from "@/lib/op112/session-key";

export async function POST(request: Request) {
  // A practice at the 112 place belongs to this login session: it ends with it instead of hanging as running.
  const sessionId = await currentSessionId();
  if (sessionId) await closeSessionPractice(sessionId).catch(() => 0);
  await logout();
  return Response.redirect(new URL("/login", request.url), 303);
}
