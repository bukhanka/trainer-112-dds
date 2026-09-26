import type { NextRequest } from "next/server";
import { z } from "zod";
import { badRequest, ddsContext } from "@/lib/dds/api";
import { say } from "@/lib/dds/calls";

const bodySchema = z.object({ text: z.string().min(1).max(2000) });

/** A line of the dispatcher in the current call; returns the call with the answer. */
export async function POST(request: NextRequest, ctx: RouteContext<"/api/dds/calls/[id]/say">) {
  const dds = await ddsContext(request, { write: true });
  if (dds instanceof Response) return dds;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return badRequest("Пустая реплика");
  const res = await say(dds.access.seat, (await ctx.params).id, body.data.text);
  if (!res.ok) return Response.json({ error: "call_failed", message: res.error }, { status: res.code });
  return Response.json(res.call);
}
