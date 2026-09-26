import { apiUser } from "@/lib/auth/session";
import { startPractice } from "@/lib/dds/seat";

/** «Тренировка без занятия»: a personal running lesson with a ДДС place for the current user. */
export async function POST() {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const res = await startPractice(user);
  if (!res.ok) return Response.json({ error: "no_service", message: res.error }, { status: 409 });
  return Response.json({ seatId: res.seat.id, lessonId: res.seat.lessonId });
}
