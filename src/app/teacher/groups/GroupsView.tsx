import Link from "next/link";
import { Badge, Empty, PageHeader, Section } from "@/components/ui";
import { isProtectedDemoGroup, isProtectedDemoLogin } from "@/lib/auth/demo";
import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { isPractice } from "@/lib/lessons/form";
import { groupScope, lessonScope } from "@/lib/teacher/access";
import { AddStudents, GroupActions, NewGroupForm, RemoveMember, RestoreGroup } from "./GroupControls";

const LAST_LESSONS = 6;

function scoreClass(v: number | null) {
  if (v == null) return "text-arm-desc";
  if (v >= 70) return "bg-emerald-50 text-emerald-800";
  if (v >= 50) return "bg-amber-50 text-amber-900";
  return "bg-red-50 text-red-700";
}

/**
 * Groups: who is in them and how each student progresses — the average confirmed score per lesson.
 * A teacher sees and keeps own groups; the administrator sees all of them and names their teachers.
 */
export async function GroupsView({ user }: { user: SessionUser }) {
  const admin = user.role === "ADMIN";
  const [groups, teachers] = await Promise.all([
    db.group.findMany({
      where: groupScope(user),
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        teacherId: true,
        archivedAt: true,
        teacher: { select: { fullName: true } },
        members: { select: { user: { select: { id: true, fullName: true, login: true, role: true, isBlocked: true } } } },
        // Only the teacher's own lessons: someone else's lesson has no report for this teacher.
        lessons: { where: { status: "FINISHED", ...lessonScope(user) }, orderBy: { startedAt: "desc" }, take: LAST_LESSONS * 2, select: { id: true, title: true, startedAt: true, settings: true } },
      },
    }),
    admin ? db.user.findMany({ where: { role: "TEACHER", isBlocked: false }, orderBy: { fullName: "asc" }, select: { id: true, fullName: true } }) : null,
  ]);
  const active = groups.filter((g) => !g.archivedAt);
  const archived = groups.filter((g) => g.archivedAt);

  const lessonIds = active.flatMap((g) => g.lessons.map((l) => l.id));
  const scores = lessonIds.length
    ? await db.attempt.groupBy({
        by: ["lessonId", "studentId"],
        where: { lessonId: { in: lessonIds }, reviewStatus: { not: "PENDING" } },
        _avg: { score: true },
        _count: { _all: true },
      })
    : [];
  const cell = (lessonId: string, studentId: string) => scores.find((s) => s.lessonId === lessonId && s.studentId === studentId);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <PageHeader
        title="Группы"
        subtitle="Состав групп и история успеваемости: средний балл подтверждённых попыток на каждом занятии, шкала 0–100. Место на занятии получают только ученики группы."
      />
      <NewGroupForm teachers={teachers} />
      {active.length ? (
        active.map((g) => {
          const lessons = g.lessons.filter((l) => !isPractice(l.settings)).slice(0, LAST_LESSONS).reverse();
          const students = g.members
            .map((m) => m.user)
            .filter((u) => u.role === "STUDENT")
            .sort((a, b) => a.fullName.localeCompare(b.fullName, "ru"));
          const demo = isProtectedDemoGroup(g.name);
          return (
            <Section
              key={g.id}
              title={`${g.name} · ${students.length} уч.`}
              actions={<GroupActions group={{ id: g.id, name: g.name, teacherId: g.teacherId }} teachers={teachers} locked={demo} />}
            >
              {students.length ? (
                <div className="overflow-x-auto">
                  <table className={`w-full text-sm ${lessons.length ? "min-w-[620px]" : ""}`}>
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
                        {lessons.length > 0 && <th className="py-1 pl-2 text-right font-medium">Изменение</th>}
                        <th className="w-16 py-1 pl-2" aria-label="Действия" />
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
                              {st.fullName} <span className="text-xs text-arm-desc">· {st.login}</span>
                              {st.isBlocked && <span className="text-xs text-red-700"> · заблокирован</span>}
                            </td>
                            {values.map((v, i) => (
                              <td key={lessons[i].id} className="px-1 py-1.5 text-center">
                                <span className={`inline-block min-w-10 rounded px-1.5 py-0.5 tabular-nums ${scoreClass(v)}`}>{v ?? "—"}</span>
                              </td>
                            ))}
                            {lessons.length > 0 && (
                              <td className={`py-1.5 pl-2 text-right tabular-nums ${trend == null ? "text-arm-desc" : trend >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                                {trend == null ? "—" : `${trend > 0 ? "+" : trend < 0 ? "−" : ""}${Math.abs(trend)}`}
                              </td>
                            )}
                            <td className="py-1.5 pl-2 text-right">
                              <RemoveMember groupId={g.id} student={{ id: st.id, fullName: st.fullName }} locked={demo && isProtectedDemoLogin(st.login)} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <p className="mt-2 text-xs text-arm-desc">
                    {lessons.length
                      ? "«—» — на занятии нет подтверждённых попыток ученика. Изменение — от первого занятия в таблице к последнему."
                      : "Проведённых занятий пока нет: история успеваемости появится после первого занятия."}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-arm-desc">В группе пока нет учеников — добавьте их кнопкой ниже.</p>
              )}
              <div className="mt-3">
                <AddStudents groupId={g.id} />
              </div>
            </Section>
          );
        })
      ) : (
        <Empty>{archived.length ? "Все группы в архиве." : "Групп пока нет."} Создайте группу выше и добавьте в неё учеников — после этого их можно посадить на места занятия.</Empty>
      )}
      {archived.length > 0 && (
        <Section title={`Архив · ${archived.length}`}>
          <ul className="divide-y divide-arm-gray/50">
            {archived.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{g.name}</span>{" "}
                  <span className="text-xs text-arm-desc">
                    · {g.members.filter((m) => m.user.role === "STUDENT").length} уч.
                    {admin && (g.teacher ? ` · ведёт ${g.teacher.fullName}` : " · преподаватель не назначен")} · в архиве с {formatDate(g.archivedAt)}
                  </span>
                </span>
                <Badge>в архиве</Badge>
                <RestoreGroup id={g.id} name={g.name} />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}
