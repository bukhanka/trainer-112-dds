import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { jsonError, op112User, ownServiceCall, readJson } from "@/lib/op112/access";
import { dutyReply } from "@/lib/op112/duty";
import { dutyContextOf, serviceCounterpart } from "@/lib/op112/phone-calls";
import type { CallLine } from "@/lib/op112/types";

const bodySchema = z.object({ text: z.string().trim().min(1).max(1000) });

// The operator passes the card to a service's duty dispatcher; the duty takes it once the number, the address
// and what happened are named (the line that takes it is marked `accepted`).
export async function POST(req: Request, ctx: RouteContext<"/api/op112/service-calls/[id]/messages">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const own = await ownServiceCall(user, id);
  if (!own) return jsonError("not_found", 404);
  if (own.call.status !== "ACTIVE") return jsonError("call_not_active", 409);
  const cp = serviceCounterpart(own.call);
  if (!cp) return jsonError("not_found", 404);
  const body = bodySchema.safeParse(await readJson(req));
  if (!body.success) return jsonError("bad_request", 400);

  const history = (Array.isArray(own.call.messages) ? own.call.messages : []) as CallLine[];
  const said: CallLine = { role: "trainee", text: body.data.text, at: new Date().toISOString() };
  const reply = await dutyReply(await dutyContextOf(own.incident, cp), history, body.data.text);
  const answer: CallLine = { role: "counterpart", text: reply.text, at: new Date().toISOString(), revealed: [], ...(reply.accepted ? { accepted: true } : {}) };

  // Re-read before writing so a hang-up during generation is not undone.
  const fresh = await db.call.findUnique({ where: { id }, select: { messages: true, status: true } });
  const current = (Array.isArray(fresh?.messages) ? fresh.messages : history) as CallLine[];
  const lines = fresh?.status === "ACTIVE" ? [said, answer] : [said];
  await db.call.update({ where: { id }, data: { messages: [...current, ...lines] as unknown as Prisma.InputJsonValue } });
  return Response.json({ lines, status: fresh?.status ?? own.call.status });
}
