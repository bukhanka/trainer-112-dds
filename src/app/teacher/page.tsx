import Link from "next/link";
import { Badge, Empty, LESSON_STATUS, LinkButton, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { lessonScope } from "@/lib/teacher/access";

export default async function TeacherHome() {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const lessons = await db.lesson.findMany({
    where: lessonScope(user),
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      group: { select: { name: true } },
      teacher: { select: { fullName: true } },
      _count: { select: { seats: true, attempts: true } },
    },
  });
  const pending = await db.attempt.groupBy({
    by: ["lessonId"],
    where: { reviewStatus: "PENDING", lessonId: { in: lessons.map((l) => l.id) } },
    _count: { _all: true },
  });
  const pendingBy = new Map(pending.map((p) => [p.lessonId, p._count._all]));
  const running = lessons.filter((l) => l.status === "RUNNING");

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <PageHeader
        title="Занятия"
        subtitle="Создайте занятие, раздайте места и задания, запустите — и весь класс виден на одном экране."
        actions={
          <LinkButton href="/teacher/lessons/new" variant="primary">
            + Новое занятие
          </LinkButton>
        }
      />

      {running.map((l) => (
        <Link
          key={l.id}
          href={`/teacher/lessons/${l.id}`}
          className="flex flex-wrap items-center gap-3 rounded border-2 border-emerald-600 bg-emerald-50 p-4 hover:bg-emerald-100"
        >
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-emerald-600" />
          </span>
          <span className="font-semibold">Идёт: {l.title}</span>
          <span className="text-sm text-arm-desc">
            {l.group?.name} · {l._count.seats} мест · с {formatDateTime(l.startedAt)}
          </span>
          <span className="ml-auto text-sm font-medium text-arm-blue">Открыть доску класса →</span>
        </Link>
      ))}

      {lessons.length ? (
        <div className="overflow-x-auto rounded border border-arm-gray/70 bg-white">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-arm-panel text-left text-xs text-arm-desc">
              <tr>
                <th className="px-3 py-2 font-medium">Занятие</th>
                <th className="px-3 py-2 font-medium">Группа</th>
                <th className="px-3 py-2 font-medium">Статус</th>
                <th className="px-3 py-2 text-right font-medium">Мест</th>
                <th className="px-3 py-2 text-right font-medium">Попыток</th>
                <th className="px-3 py-2 font-medium">Когда</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-arm-gray/50">
              {lessons.map((l) => {
                const st = LESSON_STATUS[l.status];
                const toReview = pendingBy.get(l.id) ?? 0;
                return (
                  <tr key={l.id} className="hover:bg-arm-panel/50">
                    <td className="px-3 py-2">
                      <Link href={`/teacher/lessons/${l.id}`} className="font-medium text-arm-blue hover:underline">
                        {l.title}
                      </Link>
                      {user.role === "ADMIN" && <div className="text-xs text-arm-desc">{l.teacher.fullName}</div>}
                    </td>
                    <td className="px-3 py-2">{l.group?.name ?? "—"}</td>
                    <td className="px-3 py-2">
                      <Badge tone={st.tone}>{st.label}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{l._count.seats}</td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {l._count.attempts}
                      {toReview > 0 && (
                        <Link href={`/teacher/lessons/${l.id}/attempts?status=PENDING`} className="ml-2">
                          <Badge tone="amber">{toReview} на проверке</Badge>
                        </Link>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-arm-desc">
                      {l.status === "DRAFT" ? `создано ${formatDateTime(l.createdAt)}` : formatDateTime(l.startedAt)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {l.status !== "DRAFT" && (
                        <Link href={`/teacher/lessons/${l.id}/report`} className="text-arm-blue hover:underline">
                          Отчёт
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty>Занятий пока нет. Нажмите «Новое занятие», выберите группу и раздайте места.</Empty>
      )}
    </div>
  );
}
