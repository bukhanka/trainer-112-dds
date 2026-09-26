import { audit } from "@/lib/audit";
import { jsonError, op112User } from "@/lib/op112/access";
import { findActiveSeat, startSelfTraining } from "@/lib/op112/seat";
import { currentSessionId } from "@/lib/op112/session-key";
import { buildState } from "@/lib/op112/state";

// «Тренировка без занятия»: a personal lesson with one 112 seat for this login session.
export async function POST() {
  const user = await op112User();
  if (user instanceof Response) return user;
  const sessionId = await currentSessionId();
  if (!sessionId) return jsonError("no_session", 401);
  const existing = await findActiveSeat(user.id, sessionId);
  if (!existing) {
    const seat = await startSelfTraining(user, sessionId);
    await audit({ action: "op112.training.start", actorId: user.id, actor: user.login, entity: "Lesson", entityId: seat.lessonId });
  }
  return Response.json(await buildState(user));
}
