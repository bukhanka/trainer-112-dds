import type { NextRequest } from "next/server";
import { ddsContext } from "@/lib/dds/api";
import { resume } from "@/lib/dds/calls";

/** «Снять с удержания»: back to the waiting counterpart; a conversation going on now goes on hold. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/dds/calls/[id]/resume">) {
  const dds = await ddsContext(request, { write: true });
  if (dds instanceof Response) return dds;
  const res = await resume(dds.access.seat, (await ctx.params).id);
  if (!res.ok) return Response.json({ error: "call_failed", message: res.error }, { status: res.code });
  return Response.json(res.call);
}
