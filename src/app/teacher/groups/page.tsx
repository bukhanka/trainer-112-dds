import Link from "next/link";
import { Empty, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { isPractice } from "@/lib/lessons/form";
import { groupScope, lessonScope } from "@/lib/teacher/access";

const LAST_LESSONS = 6;

function scoreClass(v: number | null) {
  if (v == null) return "text-arm-desc";
  if (v >= 70) return "bg-emerald-50 text-emerald-800";
  if (v >= 50) return "bg-amber-50 text-amber-900";
  return "bg-red-50 text-red-700";
}

/** Groups and the progress history of every student: average confirmed score per lesson. */
export default async function GroupsPage() {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const groups = await db.group.findMany({
    where: groupScope(user),
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      members: { select: { user: { select: { id: true, fullName: true, role: true, isBlocked: true } } } },
      // Only the teacher's own lessons: someone else's lesson has no report for this teacher.
      lessons: { where: { status: "FINISHED", ...lessonScope(user) }, orderBy: { startedAt: "desc" }, take: LAST_LESSONS * 2, select: { id: true, title: true, startedAt: true, settings: true } },
    },
  });

  const lessonIds = groups.flatMap((g) => g.lessons.map((l) => l.id));
  const scores = await db.attempt.groupBy({
    by: ["lessonId", "studentId"],
    where: { lessonId: { in: lessonIds }, reviewStatus: { not: "PENDING" } },
    _avg: { score: true },
    _count: { _all: true },
  });
  const cell = (lessonId: string, studentId: string) => scores.find((s) => s.lessonId === lessonId && s.studentId === studentId);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <PageHeader title="Группы" subtitle="История успеваемости: средний балл подтверждённых попыток на каждом занятии, шкала 0–100. Состав групп ведёт администратор." />
      {groups.length ? (
        groups.map((g) => {
          const lessons = g.lessons.filter((l) => !isPractice(l.settings)).slice(0, LAST_LESSONS).reverse();
          const students = g.members.map((m) => m.user).filter((u) => u.role === "STUDENT").sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"));
          return (
            <Section key={g.id} title={`${g.name} · ${students.length} уч.`}>
              {students.length && lessons.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead className="text-xs text-arm-desc">
                      <tr>
                        <th className="py-1 pr-3 text-left font-medium">Ученик</th>
                        {lessons.map((l) => (
                          <th key={l.id} className="px-1 py-1 text-center font-medium" title={l.title}>
                            <Link href={`/teacher/lessons/${l.id}/report`} className="hover:text-arm-blue">
                              {formatDate(l.startedAt)}
                            </Link>
                          </th>
                        ))}
                        <th className="py-1 pl-2 text-right font-medium">Изменение</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-arm-gray/50">
                      {students.map((st) => {
                        const values = lessons.map((l) => {
                          const c = cell(l.id, st.id);
                          return c?._avg.score == null ? null : Math.round(c._avg.score);
                        });
                        const known = values.filter((v): v is number => v != null);
                        const trend = known.length >= 2 ? known[known.length - 1] - known[0] : null;
                        return (
                          <tr key={st.id}>
                            <td className="py-1.5 pr-3">
                              {st.fullName}
                              {st.isBlocked && <span className="text-xs text-red-700"> · заблокирован</span>}
                            </td>
                            {values.map((v, i) => (
                              <td key={lessons[i].id} className="px-1 py-1.5 text-center">
                                <span className={`inline-block min-w-10 rounded px-1.5 py-0.5 tabular-nums ${scoreClass(v)}`}>{v ?? "—"}</span>
                              </td>
                            ))}
                            <td className={`py-1.5 pl-2 text-right tabular-nums ${trend == null ? "text-arm-desc" : trend >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                              {trend == null ? "—" : `${trend > 0 ? "+" : trend < 0 ? "−" : ""}${Math.abs(trend)}`}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-arm-desc">«—» — на занятии нет подтверждённых попыток ученика. Изменение — от первого занятия в таблице к последнему.</p>
                </div>
              ) : (
                <p className="text-sm text-arm-desc">{students.length ? "Проведённых занятий пока нет." : "В группе нет учеников."}</p>
              )}
            </Section>
          );
        })
      ) : (
        <Empty>У вас нет групп. Их создаёт администратор.</Empty>
      )}
    </div>
  );
}
