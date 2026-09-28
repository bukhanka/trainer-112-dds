import { saveLessonForecasts } from "@/lib/adaptive/snapshot";
import { db } from "@/lib/db";
import { followUpStartProblem } from "@/lib/followup/state";
import { lessonCoverage } from "@/lib/lessons/coverage";
import { isPractice, parseTeacherSettings } from "@/lib/lessons/form";
import { dealableScenarios } from "@/lib/lessons/options";
import { auditBy, findLesson, jsonError, teacherApi } from "@/lib/teacher/access";
import { lessonGroupProblem } from "@/lib/teacher/groups";

/** Start the lesson: from now on the workstations deliver cards and the plan is frozen. */
export async function POST(request: Request, ctx: RouteContext<"/api/teacher/lessons/[id]/start">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const lesson = await findLesson(user, id);
  if (!lesson) return jsonError("Занятие не найдено", 404);
  if (lesson.status === "RUNNING") return jsonError("Занятие уже идёт", 409);
  if (lesson.status === "FINISHED") return jsonError("Занятие уже завершено. Создайте копию, чтобы провести его ещё раз.", 409);
  // The group may have gone to the archive or to another teacher since the lesson was saved.
  const groupProblem = await lessonGroupProblem(user, lesson.groupId);
  if (groupProblem) return jsonError(groupProblem, 409);

  const seats = await db.seat.findMany({
    where: { lessonId: id },
    select: { studentId: true, role: true, scenarioIds: true, student: { select: { fullName: true, isBlocked: true } } },
  });
  if (!seats.length) return jsonError("В занятии нет ни одного места");

  // The plan was checked when saved, but scenarios and accounts may have changed since.
  const blocked = seats.filter((s) => s.student.isBlocked).map((s) => s.student.fullName);
  if (blocked.length) return jsonError(`Учётная запись заблокирована: ${blocked.join(", ")}. Уберите ученика из мест.`, 409);
  const taskIds = [...new Set(seats.flatMap((s) => s.scenarioIds))];
  if (taskIds.length) {
    const approved = new Set((await db.scenario.findMany({ where: { id: { in: taskIds }, status: "APPROVED" }, select: { id: true } })).map((s) => s.id));
    const stale = taskIds.filter((x) => !approved.has(x));
    if (stale.length) {
      const titles = (await db.scenario.findMany({ where: { id: { in: stale } }, select: { title: true } })).map((s) => `«${s.title}»`);
      return jsonError(`Задания больше не утверждены: ${titles.join(", ") || "удалены"}. Откройте «Изменить» и снимите их или утвердите сценарии.`, 409);
    }
  }

  // Places without tasks draw from the categories and location: they must have something to draw,
  // or a ДДС place would sit silently with «Нет одобренных сценариев» (lessons/coverage.ts).
  const coverage = lessonCoverage(await dealableScenarios(), parseTeacherSettings(lesson.settings), seats);
  if (coverage.blocked) return jsonError(coverage.blocked, 409);

  // A student works at one place at a time: two running lessons would split the card flow.
  // Self-practice at the workstation does not count: the teacher's lesson takes over the place.
  const busy = (
    await db.seat.findMany({
      where: { studentId: { in: seats.map((s) => s.studentId) }, lesson: { status: "RUNNING", id: { not: id } } },
      select: { student: { select: { fullName: true } }, lesson: { select: { title: true, settings: true } } },
    })
  ).filter((b) => !isPractice(b.lesson.settings));
  if (busy.length) {
    const who = busy.map((b) => `${b.student.fullName} («${b.lesson.title}»)`).join(", ");
    return jsonError(`Эти ученики уже на другом идущем занятии: ${who}. Завершите его или уберите их из мест.`, 409);
  }

  const followUpProblem = await followUpStartProblem(db, id, taskIds);
  if (followUpProblem) return jsonError(followUpProblem, 409);

  const startedAt = new Date();
  const res = await db.lesson.updateMany({ where: { id, status: "DRAFT" }, data: { status: "RUNNING", startedAt } });
  if (!res.count) return jsonError("Занятие уже запущено", 409);
  // The forecast as it stands now, to set against the fact after the lesson. A failure here must not stop the class.
  const forecasts = await saveLessonForecasts(id, { at: startedAt }).catch((err) => {
    console.error("forecast snapshot failed", id, err);
    return 0;
  });
  await auditBy(user, request, {
    action: "lesson.start",
    entity: "Lesson",
    entityId: id,
    before: { status: lesson.status },
    after: { status: "RUNNING", startedAt: startedAt.toISOString(), seats: seats.length, forecasts },
  });
  return Response.json({ ok: true, startedAt });
}
