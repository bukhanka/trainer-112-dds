import { audit } from "@/lib/audit";
import { op112User } from "@/lib/op112/access";
import { findActiveSeat, startSelfTraining } from "@/lib/op112/seat";
import { buildState } from "@/lib/op112/state";

// «Тренировка без занятия»: a personal lesson with one 112 seat for a student without a running lesson.
export async function POST() {
  const user = await op112User();
  if (user instanceof Response) return user;
  const existing = await findActiveSeat(user.id);
  if (!existing) {
    const seat = await startSelfTraining(user);
    await audit({ action: "op112.training.start", actorId: user.id, actor: user.login, entity: "Lesson", entityId: seat.lessonId });
  }
  return Response.json(await buildState(user));
}
