import { apiUser } from "@/lib/auth/session";
import { practiceKey } from "@/lib/dds/api";
import { startPractice } from "@/lib/dds/seat";

/** «Тренировка без занятия»: a personal running lesson with a ДДС place for this login session. */
export async function POST() {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const res = await startPractice(user, await practiceKey());
  if (!res.ok) return Response.json({ error: "no_service", message: res.error }, { status: 409 });
  return Response.json({ seatId: res.seat.id, lessonId: res.seat.lessonId });
}
