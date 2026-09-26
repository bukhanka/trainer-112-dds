import { notFound } from "next/navigation";
import { Badge, LESSON_STATUS, LinkButton, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { parseTeacherSettings } from "@/lib/lessons/form";
import { findLesson } from "@/lib/teacher/access";
import { LessonBoard } from "./LessonBoard";
import { LessonControls } from "./LessonControls";

const SOURCE_LABEL = { generated: "сгенерированные", students: "сформированные учениками", mixed: "смешанные" } as const;

export default async function LessonPage(props: PageProps<"/teacher/lessons/[id]">) {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const { id } = await props.params;
  const lesson = await findLesson(user, id);
  if (!lesson) notFound();
  const { projector } = await props.searchParams;
  if (projector === "1" && lesson.status !== "DRAFT") return <LessonBoard lessonId={id} status={lesson.status} projector />;

  const [group, seats] = await Promise.all([
    lesson.groupId ? db.group.findUnique({ where: { id: lesson.groupId }, select: { name: true } }) : null,
    db.seat.findMany({
      where: { lessonId: id },
      orderBy: { createdAt: "asc" },
      include: { student: { select: { fullName: true } }, service: { select: { shortName: true } } },
    }),
  ]);
  const scenarioIds = [...new Set(seats.flatMap((s) => s.scenarioIds))];
  const scenarios = await db.scenario.findMany({ where: { id: { in: scenarioIds } }, select: { id: true, title: true } });
  const scenarioTitle = new Map(scenarios.map((s) => [s.id, s.title]));
  const settings = parseTeacherSettings(lesson.settings);
  const st = LESSON_STATUS[lesson.status];

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <PageHeader
        back={{ href: "/teacher", label: "Занятия" }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {lesson.title} <Badge tone={st.tone}>{st.label}</Badge>
          </span>
        }
        subtitle={
          <>
            {group?.name ?? "без группы"} · {seats.length} мест · карточки: {SOURCE_LABEL[settings.cardSource]}
            {lesson.startedAt && <> · начато {formatDateTime(lesson.startedAt)}</>}
            {lesson.finishedAt && <> · завершено {formatDateTime(lesson.finishedAt)}</>}
          </>
        }
        actions={<LessonControls id={id} status={lesson.status} />}
      />

      {lesson.status !== "DRAFT" && (
        <div className="flex flex-wrap gap-2 text-sm">
          <LinkButton size="sm" href={`/teacher/lessons/${id}/attempts`}>
            Проверка попыток
          </LinkButton>
          <LinkButton size="sm" href={`/teacher/lessons/${id}/report`}>
            Отчёт
          </LinkButton>
          <LinkButton size="sm" href={`/teacher/lessons/${id}?projector=1`}>
            ⛶ Режим проектора
          </LinkButton>
        </div>
      )}

      {lesson.status !== "DRAFT" && <LessonBoard key={lesson.status} lessonId={id} status={lesson.status} />}

      <Section title={lesson.status === "DRAFT" ? "Места и задания" : "План занятия: места и задания"}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead className="text-left text-xs text-arm-desc">
              <tr>
                <th className="py-1 pr-3 font-medium">Место</th>
                <th className="py-1 pr-3 font-medium">Ученик</th>
                <th className="py-1 pr-3 font-medium">Роль</th>
                <th className="py-1 pr-3 font-medium">Служба</th>
                <th className="py-1 font-medium">Задания</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-arm-gray/50">
              {seats.map((s) => (
                <tr key={s.id}>
                  <td className="py-1.5 pr-3 font-medium">{s.label}</td>
                  <td className="py-1.5 pr-3">{s.student.fullName}</td>
                  <td className="py-1.5 pr-3">{s.role === "OP112" ? "Оператор 112" : "Диспетчер ДДС"}</td>
                  <td className="py-1.5 pr-3">{s.service?.shortName ?? "—"}</td>
                  <td className="py-1.5 text-xs">
                    {s.scenarioIds.length ? s.scenarioIds.map((x) => scenarioTitle.get(x) ?? "удалён").join("; ") : <span className="text-arm-desc">из категорий</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
