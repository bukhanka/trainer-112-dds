/**
 * «Завершить занятие» ends the conversations still going at the 112 places. Without it a caller stayed on the line in a
 * finished lesson and kept answering («Разговор 13:44» on the workstation). A call that is still ringing becomes missed.
 * The open card stays: the operator saves it and marks it «отработана» as before (op112/seat.ts, findSeatWithOpenCard).
 * The calls of the ДДС places are closed by their own end-of-lesson review (dds/review.ts, closeLessonCalls), which also
 * ends the hold periods.
 */
import { db } from "@/lib/db";

export async function hangUp112Calls(lessonId: string, now = new Date()): Promise<{ ended: number; missed: number }> {
  const at112 = { lessonId, seat: { role: "OP112" as const } };
  // Ringing first: a call answered in between is caught by the second update.
  const missed = await db.call.updateMany({ where: { ...at112, status: "RINGING" }, data: { status: "MISSED", endedAt: now } });
  const ended = await db.call.updateMany({ where: { ...at112, status: "ACTIVE" }, data: { status: "ENDED", endedAt: now } });
  return { ended: ended.count, missed: missed.count };
}
