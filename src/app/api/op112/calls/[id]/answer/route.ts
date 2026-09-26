import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { jsonError, op112User, ownCall } from "@/lib/op112/access";
import { callerOpening, type Persona } from "@/lib/op112/caller";
import { operatorNumber } from "@/lib/op112/seat";
import { armNumber, buildState } from "@/lib/op112/state";
import type { CallLine } from "@/lib/op112/types";
import { channelOf } from "@/lib/op112/phone";

type Counterpart = { phone?: string; scenarioId?: string; persona?: Persona };

// «Принять»: the call becomes active, a new card opens and its typing timer starts.
export async function POST(_req: Request, ctx: RouteContext<"/api/op112/calls/[id]/answer">) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const call = await ownCall(user, id);
  if (!call?.seat) return jsonError("not_found", 404);
  if (call.status !== "RINGING") return Response.json(await buildState(user));
  if (call.seat.lesson.status !== "RUNNING") return jsonError("lesson_finished", 409);

  const cp = (call.counterpart ?? {}) as Counterpart;
  const opening = cp.persona ? await callerOpening(cp.persona) : { text: "Алло! Помогите!", revealed: [] };
  const now = new Date();
  const line: CallLine = { role: "counterpart", text: opening.text, at: now.toISOString(), revealed: opening.revealed };

  // Only one answer wins if the button is pressed twice.
  const claimed = await db.call.updateMany({ where: { id: call.id, status: "RINGING" }, data: { status: "ACTIVE", answeredAt: now } });
  if (claimed.count === 0) return Response.json(await buildState(user));

  const incident = await db.incident.create({
    data: {
      lessonId: call.seat.lessonId,
      scenarioId: cp.scenarioId ?? null,
      source: "op112",
      createdBySeatId: call.seat.id,
      operatorNo: operatorNumber(user.login),
      armNo: armNumber(call.seat),
      status: "draft",
      caller: { aon: cp.phone ?? "", channel: channelOf(cp.phone ?? "") },
      address: { subject: "Москва" },
      flags: {},
      tags: [],
      description: "",
      openedAt: now,
    },
  });
  await db.call.update({
    where: { id: call.id },
    data: { incidentId: incident.id, messages: [line] as unknown as Prisma.InputJsonValue },
  });
  return Response.json(await buildState(user));
}
