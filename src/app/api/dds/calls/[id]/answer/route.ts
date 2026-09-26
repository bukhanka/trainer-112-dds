import type { NextRequest } from "next/server";
import { ddsContext } from "@/lib/dds/api";
import { answer } from "@/lib/dds/calls";

/** Pick up an incoming call. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/dds/calls/[id]/answer">) {
  const dds = await ddsContext(request, { write: true });
  if (dds instanceof Response) return dds;
  const res = await answer(dds.access.seat, (await ctx.params).id);
  if (!res.ok) return Response.json({ error: "call_failed", message: res.error }, { status: res.code });
  return Response.json(res.call);
}
