import type { NextRequest } from "next/server";
import { ddsContext } from "@/lib/dds/api";
import { hangUp } from "@/lib/dds/calls";

/** Put the handset down (or decline a ringing call). */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/dds/calls/[id]/hangup">) {
  const dds = await ddsContext(request, { write: true });
  if (dds instanceof Response) return dds;
  const res = await hangUp(dds.access.seat, (await ctx.params).id);
  if (!res.ok) return Response.json({ error: "call_failed", message: res.error }, { status: res.code });
  return Response.json(res.call);
}
