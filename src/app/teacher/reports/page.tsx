import Link from "next/link";
import { Badge, Empty, LESSON_STATUS, PageHeader } from "@/components/ui";
import { getForecastHistory, getGroupForecast } from "@/lib/adaptive/teacher";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { countLabel, formatDateTime } from "@/lib/format";
import { lessonScope } from "@/lib/teacher/access";
import { ForecastHistorySection } from "./ForecastHistorySection";
import { GroupForecastSection } from "./GroupForecastSection";

export default async function ReportsPage() {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const [forecast, history] = await Promise.all([getGroupForecast(user), getForecastHistory(user)]);
  const lessons = await db.lesson.findMany({
    where: { ...lessonScope(user), status: { not: "DRAFT" } },
    orderBy: { startedAt: "desc" },
    select: { id: true, title: true, status: true, startedAt: true, group: { select: { name: true } }, _count: { select: { seats: true } } },
  });
  const stats = await db.attempt.groupBy({
    by: ["lessonId", "reviewStatus"],
    where: { lessonId: { in: lessons.map((l) => l.id) } },
    _count: { _all: true, score: true },
    _avg: { score: true },
  });
  const of = (id: string) => {
    const rows = stats.filter((s) => s.lessonId === id);
    const reviewed = rows.filter((r) => r.reviewStatus !== "PENDING");
    // Weighted by attempts that have a score, the same way the lesson report averages.
    const scored = reviewed.reduce((a, r) => a + r._count.score, 0);
    const sum = reviewed.reduce((a, r) => a + (r._avg.score ?? 0) * r._count.score, 0);
    return {
      reviewed: reviewed.reduce((a, r) => a + r._count._all, 0),
      pending: rows.find((r) => r.reviewStatus === "PENDING")?._count._all ?? 0,
      avg: scored ? Math.round(sum / scored) : null,
    };
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <PageHeader title="Отчёты" subtitle="Отчёт занятия: время против норматива, ошибки, баллы, лидеры и отстающие, типичные ошибки группы. В отчёт идут только подтверждённые попытки." />
      <GroupForecastSection data={forecast} />
      <ForecastHistorySection data={history} />
      <h2 className="text-base font-semibold text-arm-dark">Проведённые занятия</h2>
      {lessons.length ? (
        <ul className="divide-y divide-arm-gray/50 rounded border border-arm-gray/70 bg-white">
          {lessons.map((l) => {
            const st = of(l.id);
            const ls = LESSON_STATUS[l.status];
            return (
              <li key={l.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href={`/teacher/lessons/${l.id}/report`} className="font-medium text-arm-blue hover:underline">
                    {l.title}
                  </Link>
                  <div className="text-xs text-arm-desc">
                    {l.group?.name ?? "без группы"} · {formatDateTime(l.startedAt)} · {countLabel(l._count.seats, ["место", "места", "мест"])}
                  </div>
                </div>
                <Badge tone={ls.tone}>{ls.label}</Badge>
                <span className="tabular-nums">
                  подтверждено {st.reviewed}
                  {st.pending > 0 && <span className="text-amber-700"> · на проверке {st.pending}</span>}
                </span>
                <span className="w-24 text-right tabular-nums">
                  ср. балл <b>{st.avg ?? "—"}</b>
                </span>
                <a href={`/api/teacher/lessons/${l.id}/report/csv`} className="text-arm-blue hover:underline">
                  CSV
                </a>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>Отчёты появятся после первого проведённого занятия.</Empty>
      )}
    </div>
  );
}
