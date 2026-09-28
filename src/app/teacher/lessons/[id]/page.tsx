import { notFound } from "next/navigation";
import { Badge, LESSON_STATUS, LinkButton, PageHeader, Section } from "@/components/ui";
import { studentRatings, teacherLessons } from "@/lib/adaptive/levels";
import type { Rating } from "@/lib/adaptive/rating";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { countLabel, formatDateTime } from "@/lib/format";
import { coverageWarnings, lessonCoverage } from "@/lib/lessons/coverage";
import { parseTeacherSettings } from "@/lib/lessons/form";
import { dealableScenarios } from "@/lib/lessons/options";
import { placeLabel } from "@/lib/scenarios/location";
import { describePassRules, passRulesOf } from "@/lib/scoring/pass";
import { findLesson } from "@/lib/teacher/access";
import { CoverageNotice } from "../ScenarioCoverage";
import { serviceLabel } from "@/lib/lessons/service-label";
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
      include: { student: { select: { fullName: true } }, service: { select: { shortName: true, fullName: true } } },
    }),
  ]);
  const scenarioIds = [...new Set(seats.flatMap((s) => s.scenarioIds))];
  const [scenarios, levels] = await Promise.all([
    db.scenario.findMany({ where: { id: { in: scenarioIds } }, select: { id: true, title: true } }),
    studentRatings(seats.map((s) => s.studentId), { scope: teacherLessons(lesson.teacherId) }),
  ]);
  const scenarioTitle = new Map(scenarios.map((s) => [s.id, s.title]));
  const settings = parseTeacherSettings(lesson.settings);
  const st = LESSON_STATUS[lesson.status];
  // Before the start: will the places without tasks have anything to draw? (lessons/coverage.ts)
  const coverage = lesson.status === "DRAFT" ? lessonCoverage(await dealableScenarios(), settings, seats) : null;
  const from = `из категорий${settings.location ? `, округ или район: ${placeLabel(settings.location)}` : ""}`;

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
            {group?.name ?? "без группы"} · {countLabel(seats.length, ["место", "места", "мест"])} · карточки: {SOURCE_LABEL[settings.cardSource]} · зачёт: {describePassRules(passRulesOf(settings))}
            {settings.location && <> · локация: {placeLabel(settings.location)}</>}
            {settings.commentTemplate.trim() && <> · шаблон итогового комментария ДДС задан</>}
            {lesson.startedAt && <> · начато {formatDateTime(lesson.startedAt)}</>}
            {lesson.finishedAt && <> · завершено {formatDateTime(lesson.finishedAt)}</>}
          </>
        }
        actions={<LessonControls id={id} status={lesson.status} startBlocked={coverage?.blocked ?? null} />}
      />

      {coverage && <CoverageNotice coverage={coverage} warnings={coverageWarnings(coverage, settings)} location={settings.location} />}

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
                <th className="py-1 pr-3 font-medium" title="Рейтинг ученика в роли этого места и сложность заданий, которую он подсказывает">
                  Уровень сейчас
                </th>
                <th className="py-1 font-medium">Задания</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-arm-gray/50">
              {seats.map((s) => (
                <tr key={s.id}>
                  <td className="py-1.5 pr-3 font-medium">{s.label}</td>
                  <td className="py-1.5 pr-3">{s.student.fullName}</td>
                  <td className="py-1.5 pr-3">{s.role === "OP112" ? "Оператор 112" : "Диспетчер ДДС"}</td>
                  <td className="py-1.5 pr-3" title={s.service?.fullName ?? undefined}>
                    {s.service ? serviceLabel(s.service.shortName, s.service.fullName) : "—"}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-3 tabular-nums">
                    <LevelCell level={levels.get(s.studentId)?.[s.role]} />
                  </td>
                  <td className="py-1.5 text-xs">
                    {s.scenarioIds.length ? (
                      s.scenarioIds.map((x) => scenarioTitle.get(x) ?? "удалён").join("; ")
                    ) : (
                      <span className="text-arm-desc">{settings.adaptive ? `${from}, по уровню ученика` : from}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {seats.some((s) => levels.get(s.studentId)?.[s.role]) && (
          <p className="mt-2 text-xs text-arm-desc">
            Уровень — рейтинг ученика в роли места по его прошлым попыткам, как в шахматах: новичок начинает с 1200, удачная работа поднимает
            рейтинг, ошибки — снижают. «Сложность ≈ 5 из 10» — задания такой сложности место без заданий получает при адаптивной сложности
            (у каждого сценария сложность от 1 до 10).
          </p>
        )}
      </Section>
    </div>
  );
}

function LevelCell({ level }: { level: Rating | undefined }) {
  if (!level) return <>—</>;
  return (
    <>
      {level.rating}{" "}
      <span className="text-xs text-arm-desc">
        · сложность заданий ≈ {level.difficulty} из 10
        {level.attempts ? "" : " · новичок"}
      </span>
    </>
  );
}
