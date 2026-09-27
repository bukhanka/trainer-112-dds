import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { db } from "@/lib/db";
import { jsonError, op112User, ownCall, personaOfCall, readJson } from "@/lib/op112/access";
import { callerReply, genderOfName, lineTurn, noiseLines, type LineTurn } from "@/lib/op112/caller";
import type { CallLine } from "@/lib/op112/types";

const bodySchema = z.object({ text: z.string().trim().min(1).max(1000) });

// The operator says something; the AI caller answers. Both lines are kept in Call.messages. A silent line answers
// with silence, a breaking line with the beeps — then the call is over (the «нет контакта» / «срыв звонка» tasks).
export async function POST(req: Request, ctx: RouteContext<"/api/op112/calls/[id]/messages">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const call = await ownCall(user, id);
  if (!call) return jsonError("not_found", 404);
  if (call.status !== "ACTIVE") return jsonError("call_not_active", 409);
  const body = bodySchema.safeParse(await readJson(req));
  if (!body.success) return jsonError("bad_request", 400);

  const persona = await personaOfCall(call);
  const history = (Array.isArray(call.messages) ? call.messages : []) as CallLine[];
  const said: CallLine = { role: "trainee", text: body.data.text, at: new Date().toISOString() };
  const turn: LineTurn = persona ? lineTurn(persona, history, body.data.text) : { kind: "talk" };
  let answers: CallLine[];
  if (turn.kind === "talk") {
    const reply = persona
      ? await callerReply(persona, history, body.data.text, genderOfName(user.fullName))
      : { text: "Алло? Вас плохо слышно…", revealed: [] as string[] };
    answers = [{ role: "counterpart", text: reply.text, at: new Date().toISOString(), revealed: reply.revealed }];
  } else answers = noiseLines(turn, new Date().toISOString());
  const cutOff = answers.some((l) => l.noise === "hangup");

  // Re-read before writing so a hang-up during generation is not undone.
  const fresh = await db.call.findUnique({ where: { id: call.id }, select: { messages: true, status: true } });
  const current = (Array.isArray(fresh?.messages) ? fresh.messages : history) as CallLine[];
  const live = fresh?.status === "ACTIVE";
  const lines = live ? [said, ...answers] : [said];
  const end = live && cutOff ? { status: "ENDED" as const, endedAt: new Date() } : {};
  await db.call.update({ where: { id: call.id }, data: { messages: [...current, ...lines] as unknown as Prisma.InputJsonValue, ...end } });
  return Response.json({ lines, status: live && cutOff ? "ENDED" : (fresh?.status ?? call.status) });
}
