import type { NextRequest } from "next/server";
import { ddsContext } from "@/lib/dds/api";
import { hold } from "@/lib/dds/calls";

/** «Удержание»: the counterpart waits on the line, the line is free for another call. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/dds/calls/[id]/hold">) {
  const dds = await ddsContext(request, { write: true });
  if (dds instanceof Response) return dds;
  const res = await hold(dds.access.seat, (await ctx.params).id);
  if (!res.ok) return Response.json({ error: "call_failed", message: res.error }, { status: res.code });
  return Response.json(res.call);
}
