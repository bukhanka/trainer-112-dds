import { audit } from "@/lib/audit";
import { jsonError, op112User } from "@/lib/op112/access";
import { finishSelfTraining, findActiveSeat } from "@/lib/op112/seat";
import { currentSessionId } from "@/lib/op112/session-key";
import { buildState } from "@/lib/op112/state";

// «Завершить тренировку»: the student ends own practice at the 112 place; no more calls ring.
export async function POST() {
  const user = await op112User();
  if (user instanceof Response) return user;
  const seat = await findActiveSeat(user.id, await currentSessionId());
  if (!seat) return jsonError("not_practice", 409);
  const r = await finishSelfTraining(user, seat);
  if (!r.ok) return jsonError(r.error, 409);
  await audit({ action: "op112.training.finish", actorId: user.id, actor: user.login, entity: "Lesson", entityId: seat.lessonId });
  return Response.json(await buildState(user));
}
