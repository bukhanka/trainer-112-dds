import { formatDateTime } from "@/lib/format";
import { attachment, toCsv, type Cell } from "@/lib/reports/csv";
import { buildLessonReport } from "@/lib/reports/lesson";
import { loadReportInput } from "@/lib/reports/load";
import { describePassRules, passLabel } from "@/lib/scoring/pass";
import { auditBy, findLesson, jsonError, teacherApi } from "@/lib/teacher/access";

const REVIEW = { PENDING: "на проверке", CONFIRMED: "подтверждено", OVERRIDDEN: "исправлено преподавателем" } as const;
// Only confirmed attempts are exported (see buildLessonReport); PENDING stays in the map for type safety.

/** Lesson report as CSV: ?kind=students (default) — a row per student, ?kind=attempts — a row per attempt. */
export async function GET(request: Request, ctx: RouteContext<"/api/teacher/lessons/[id]/report/csv">) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const { id } = await ctx.params;
  const lesson = await findLesson(user, id);
  if (!lesson) return jsonError("Занятие не найдено", 404);

  const kind = new URL(request.url).searchParams.get("kind") === "attempts" ? "attempts" : "students";
  const report = buildLessonReport(await loadReportInput(lesson));
  const rows: Cell[][] =
    kind === "students"
      ? [
          [
            "ФИО",
            "Место",
            "Роль",
            "Служба",
            "Подтверждено попыток",
            "На проверке",
            "Что замерено",
            "Среднее время, с",
            "Норматив, с",
            "Отличие от норматива, с",
            "Опозданий",
            "Действий",
            "Ошибок",
            "Ошибок в тексте",
            "Критичных ошибок",
            "Средний балл",
            "Уровень готовности",
            "Частые ошибки",
            "Зачтено попыток",
            "Критерии зачёта",
          ],
          ...report.students.map((r) => [
            r.name,
            r.seat,
            r.role === "OP112" ? "Оператор 112" : "Диспетчер ДДС",
            r.service,
            r.reviewed,
            r.pending,
            r.timeLabel,
            r.avgTimeSec,
            r.normSec,
            r.deltaSec,
            r.lateCount,
            r.actions,
            r.errors,
            r.textErrors,
            r.critical,
            r.avgScore,
            r.readiness?.label,
            r.topFailed.map((f) => `${f.title} (${f.count})`).join("; "),
            r.passed,
            describePassRules(report.pass),
          ]),
        ]
      : [
          ["ФИО", "Место", "Роль", "Карточка", "Задание", "Время попытки", "Время, с", "Норматив, с", "Отличие, с", "Ошибок", "Какие ошибки", "Балл", "Проверка", "Комментарий преподавателя", "Зачёт", "Почему не зачтено"],
          ...report.attempts.map((a) => [
            a.student,
            a.seat,
            a.kind === "OP112" ? "112" : "ДДС",
            a.incidentNumber,
            a.scenarioTitle,
            formatDateTime(a.createdAt),
            a.timeSec,
            a.normSec,
            a.timeSec == null ? null : a.timeSec - a.normSec,
            a.failedTitles.length,
            a.failedTitles.join("; "),
            a.score,
            REVIEW[a.reviewStatus],
            a.teacherComment,
            passLabel(a.pass),
            a.pass?.reasons.join("; "),
          ]),
        ];

  // Moscow date, as everywhere in the cabinet: «2026-09-25».
  const date = (lesson.startedAt ?? lesson.createdAt).toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" });
  await auditBy(user, request, { action: "report.export", entity: "Lesson", entityId: id, after: { kind, rows: rows.length - 1 } });
  return new Response(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": attachment(`Отчёт ${date} ${lesson.title.replace(/[\\/:*?"<>|]+/g, " ")} ${kind === "students" ? "ученики" : "попытки"}.csv`),
      "Cache-Control": "no-store",
    },
  });
}
