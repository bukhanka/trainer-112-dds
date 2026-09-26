import { db } from "@/lib/db";

// Public liveness probe for docker healthchecks and external monitoring. Returns no data.
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
