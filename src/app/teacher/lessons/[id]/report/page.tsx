import Link from "next/link";
import { notFound } from "next/navigation";
import { BarChart, niceMax } from "@/components/charts";
import { Badge, LinkButton, PageHeader, Section, Stat } from "@/components/ui";
import { loadRatingAttempts, teacherLessons } from "@/lib/adaptive/levels";
import { lessonLevels } from "@/lib/adaptive/report";
import { lessonForecast } from "@/lib/adaptive/teacher";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateTime, formatDelta, formatDuration, plural, shortName } from "@/lib/format";
import { buildLessonReport } from "@/lib/reports/lesson";
import { loadReportInput } from "@/lib/reports/load";
import { describePassRules } from "@/lib/scoring/pass";
import { WEIGHT_GROUPS } from "@/lib/scoring/score";
import { findLesson } from "@/lib/teacher/access";
import { ForecastVsFact } from "./ForecastVsFact";

const READY_TONE = { green: "green", blue: "blue", amber: "amber", red: "red" } as const;

function heatColor(rate: number | null): string {
  if (rate == null) return "bg-white text-arm-desc";
  if (rate === 0) return "bg-emerald-50 text-emerald-800";
  if (rate < 34) return "bg-amber-100 text-amber-900";
  if (rate < 67) return "bg-orange-300 text-orange-950";
  return "bg-red-600 text-white";
}

export default async function LessonReportPage(props: PageProps<"/teacher/lessons/[id]/report">) {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const { id } = await props.params;
  const lesson = await findLesson(user, id);
  if (!lesson) notFound();
  const group = lesson.groupId ? await db.group.findUnique({ where: { id: lesson.groupId }, select: { name: true } }) : null;
  const input = await loadReportInput(lesson);
  const report = buildLessonReport(input);
  const forecast = await lessonForecast(lesson.id, input);
  const levels = lessonLevels({
    lessonId: lesson.id,
    start: lesson.startedAt ?? new Date(),
    seats: input.seats.map((x) => ({ studentId: x.studentId, name: x.studentName, seat: x.label, role: x.role })),
    attempts: await loadRatingAttempts(input.seats.map((x) => x.studentId), { scope: teacherLessons(lesson.teacherId) }),
  });
  const s = report.summary;
  const duration = lesson.startedAt ? ((lesson.finishedAt ?? new Date()).getTime() - lesson.startedAt.getTime()) / 1000 : null;
  const withTime = report.students.filter((r) => r.avgTimeSec != null);
  const timeMax = niceMax(Math.max(0, ...withTime.map((r) => Math.max(r.avgTimeSec!, r.normSec))) * 1.1);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <PageHeader
        back={{ href: `/teacher/lessons/${id}`, label: lesson.title }}
        title={`Отчёт занятия «${lesson.title}»`}
        subtitle={
          <>
            {group?.name ?? "без группы"} · {lesson.startedAt ? formatDateTime(lesson.startedAt) : "не проводилось"}
            {duration != null && <> · длительность {formatDuration(duration)}</>}
            {lesson.status === "RUNNING" && " · занятие ещё идёт"}
            <> · зачёт: {describePassRules(report.pass)}</>
          </>
        }
        actions={
          <>
            <LinkButton href={`/api/teacher/lessons/${id}/report/csv`} prefetch={false} variant="primary">
              ↓ CSV по ученикам
            </LinkButton>
            <LinkButton href={`/api/teacher/lessons/${id}/report/csv?kind=attempts`} prefetch={false}>
              ↓ CSV по попыткам
            </LinkButton>
          </>
        }
      />

      {s.pending > 0 && (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          В отчёт вошли только подтверждённые преподавателем попытки ({s.reviewed}). Ещё {s.pending} ждут проверки —{" "}
          <Link href={`/teacher/lessons/${id}/attempts?status=PENDING`} className="font-medium underline">
            проверить
          </Link>
          .
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Учеников на местах" value={s.students} />
        <Stat label="Подтверждённых попыток" value={s.reviewed} hint={s.pending ? `ещё ${s.pending} на проверке` : "все проверены"} />
        <Stat label="Средний балл (0–100)" value={s.avgScore ?? "—"} />
        <Stat label="Зачтено попыток" value={s.judged ? `${s.passed} из ${s.judged}` : "—"} hint={describePassRules(report.pass)} />
        <Stat
          label="Согласие преподавателя с черновиком"
          value={s.agreement.rate == null ? "—" : `${s.agreement.rate} %`}
          hint={s.agreement.checks ? `исправлено ${s.agreement.changed} из ${s.agreement.checks} ${plural(s.agreement.checks, ["проверки", "проверок", "проверок"])}${s.agreement.aiChecks ? `, из них ИИ: ${s.agreement.aiChanged} из ${s.agreement.aiChecks}` : ""}` : undefined}
        />
      </div>

      <Section title="Выводы по занятию">
        <p className="text-sm">{report.insight}</p>
      </Section>

      <div className="grid gap-4 md:grid-cols-2">
        <Section title="Лидеры — и почему">
          {report.leaders.length ? (
            <ol className="flex flex-col gap-2 text-sm">
              {report.leaders.map(({ row, why }, i) => (
                <li key={row.studentId} className="flex gap-2">
                  <span className="font-semibold tabular-nums text-emerald-700">{i + 1}.</span>
                  <span>
                    <b>{row.name}</b> · {row.seat} · балл <b>{row.avgScore}</b>
                    <span className="block text-arm-desc">{why}</span>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-arm-desc">Нет подтверждённых попыток.</p>
          )}
        </Section>
        <Section title="Отстающие — и почему">
          {report.laggards.length ? (
            <ol className="flex flex-col gap-2 text-sm">
              {report.laggards.map(({ row, why }) => (
                <li key={row.studentId}>
                  <b>{row.name}</b> · {row.seat} · балл <b className="text-red-700">{row.avgScore}</b>
                  <span className="block text-arm-desc">{why}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-arm-desc">Отстающих нет или мало данных.</p>
          )}
        </Section>
      </div>

      <Section title="Ученики">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] text-sm">
            <thead className="text-left text-xs text-arm-desc">
              <tr className="border-b border-arm-gray/60">
                <th className="py-1.5 pr-3 font-medium">ФИО</th>
                <th className="py-1.5 pr-3 font-medium">Место</th>
                <th className="py-1.5 pr-3 text-right font-medium">Попыток</th>
                <th className="py-1.5 pr-3 font-medium">Среднее время</th>
                <th className="py-1.5 pr-3 text-right font-medium">Норматив</th>
                <th className="py-1.5 pr-3 text-right font-medium">Отличие</th>
                <th className="py-1.5 pr-3 text-right font-medium">Действий</th>
                <th className="py-1.5 pr-3 text-right font-medium">Ошибок</th>
                <th className="py-1.5 pr-3 text-right font-medium">В тексте</th>
                <th className="py-1.5 pr-3 text-right font-medium">Балл</th>
                <th className="py-1.5 pr-3 text-right font-medium" title={`Критерии занятия: ${describePassRules(report.pass)}`}>
                  Зачтено
                </th>
                <th className="py-1.5 font-medium">Готовность</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-arm-gray/50">
              {report.students.map((r) => (
                <tr key={r.studentId}>
                  <td className="py-1.5 pr-3 font-medium">{r.name}</td>
                  <td className="py-1.5 pr-3">
                    {r.seat} · {r.role === "OP112" ? "112" : `ДДС${r.service ? `, ${r.service}` : ""}`}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {r.reviewed}
                    {r.pending > 0 && <span className="text-xs text-amber-700"> +{r.pending}</span>}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">
                    {formatDuration(r.avgTimeSec)} <span className="text-xs text-arm-desc">{r.timeLabel}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{formatDuration(r.normSec)}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${(r.deltaSec ?? 0) > 0 ? "font-semibold text-red-700" : "text-emerald-700"}`}>{formatDelta(r.deltaSec)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.actions}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${r.errors ? "text-red-700" : ""}`}>
                    {r.errors}
                    {r.critical > 0 && <span className="text-xs"> (крит. {r.critical})</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{r.textErrors}</td>
                  <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">{r.avgScore ?? "—"}</td>
                  <td className={`whitespace-nowrap py-1.5 pr-3 text-right tabular-nums ${r.judged && r.passed < r.judged ? "text-red-700" : ""}`}>
                    {r.judged ? `${r.passed} из ${r.judged}` : "—"}
                  </td>
                  <td className="py-1.5">{r.readiness ? <Badge tone={READY_TONE[r.readiness.tone]}>{r.readiness.label}</Badge> : <span className="text-xs text-arm-desc">нет данных</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-arm-desc">
          Время: у места 112 — набор карточки до сохранения, у места ДДС — от «Добавлена» до «Принята / Не принята». «В тексте» — ошибки понятности текста.
          «Зачтено» — подтверждённые попытки, которые прошли критерии занятия: {describePassRules(report.pass)}.
        </p>
      </Section>

      <ForecastVsFact data={forecast} status={lesson.status} />

      <Section title="Уровень учеников «как в шахматах»: до и после занятия">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="text-left text-xs text-arm-desc">
              <tr className="border-b border-arm-gray/60">
                <th className="py-1.5 pr-3 font-medium">ФИО</th>
                <th className="py-1.5 pr-3 font-medium">Место</th>
                <th className="py-1.5 pr-3 text-right font-medium">Уровень до</th>
                <th className="py-1.5 pr-3 text-right font-medium">После</th>
                <th className="py-1.5 pr-3 text-right font-medium">Изменение</th>
                <th className="py-1.5 pr-3 font-medium">Сложность заданий занятия</th>
                <th className="py-1.5 font-medium">Дальше — задания сложности</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-arm-gray/50">
              {levels.map((r) => (
                <tr key={r.studentId}>
                  <td className="py-1.5 pr-3 font-medium">{r.name}</td>
                  <td className="py-1.5 pr-3">
                    {r.seat} · {r.role === "OP112" ? "112" : "ДДС"}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">
                    {r.before}
                    {r.newcomer && <span className="text-xs text-arm-desc"> новичок</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">{r.after}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${r.delta > 0 ? "text-emerald-700" : r.delta < 0 ? "text-red-700" : "text-arm-desc"}`}>
                    {r.delta > 0 ? "+" : r.delta < 0 ? "−" : ""}
                    {Math.abs(r.delta)}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">
                    {r.tasks ? (
                      <>
                        {r.tasks.min === r.tasks.max ? r.tasks.min : `${r.tasks.min}–${r.tasks.max}`}
                        <span className="text-xs text-arm-desc"> · попыток {r.lessonAttempts}</span>
                      </>
                    ) : (
                      <span className="text-xs text-arm-desc">попыток с баллом нет</span>
                    )}
                  </td>
                  <td className="py-1.5 tabular-nums">{r.difficulty} из 10</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-arm-desc">
          Уровень — рейтинг Эло в роли места: задание сложности d «играет» с рейтингом 900 + 100·d, на задании своего уровня ожидаемый балл 70. Балл выше
          ожидаемого поднимает уровень, ниже — опускает; черновик до подтверждения весит вдвое меньше. Место без заданий в адаптивном занятии получает
          карточки рядом с рекомендуемой сложностью.
        </p>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Средний балл по ученикам">
          <BarChart
            unit=""
            max={100}
            bars={report.students.map((r) => ({
              key: r.studentId,
              label: shortName(r.name),
              value: r.avgScore,
              valueLabel: r.avgScore ?? "—",
              tone: r.avgScore == null ? "gray" : r.avgScore >= 70 ? "green" : r.avgScore >= 50 ? "amber" : "red",
            }))}
          />
          <p className="mt-2 text-xs text-arm-desc">Шкала 0–100. Зелёный — 70 и выше, жёлтый — 50–69, красный — ниже 50.</p>
        </Section>
        <Section title="Время против норматива">
          {withTime.length ? (
            <BarChart
              unit="с"
              max={timeMax}
              markerLabel="норматив места (у 112 и ДДС он разный)"
              bars={withTime.map((r) => ({
                key: r.studentId,
                label: `${shortName(r.name)} · ${r.role === "OP112" ? "112" : "ДДС"}`,
                value: r.avgTimeSec,
                marker: r.normSec,
                valueLabel: `${r.avgTimeSec} с`,
                tone: (r.deltaSec ?? 0) > 0 ? "red" : "green",
              }))}
            />
          ) : (
            <p className="text-sm text-arm-desc">Нет данных о времени.</p>
          )}
        </Section>
      </div>

      <Section title="Типичные ошибки группы">
        {report.typical.length ? (
          <BarChart
            unit="%"
            max={100}
            labelWidth="22rem"
            bars={report.typical.slice(0, 10).map((t) => ({
              key: t.title,
              label: t.title,
              title: WEIGHT_GROUPS[t.group],
              value: t.rate,
              valueLabel: `${t.failed} из ${t.applicable}`,
              tone: t.rate >= 50 ? "red" : "amber",
            }))}
          />
        ) : (
          <p className="text-sm text-arm-desc">Ошибок нет.</p>
        )}
        <p className="mt-2 text-xs text-arm-desc">Доля подтверждённых попыток, где проверка применима и провалена.</p>
      </Section>

      {report.heat.rows.length > 0 && (
        <Section title="Тепловая карта ошибок: ученик × группа проверок">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0.5 text-xs">
              <thead>
                <tr>
                  <th className="p-1 text-left font-medium text-arm-desc">Ученик</th>
                  {report.heat.groups.map((g) => (
                    <th key={g} className="p-1 text-center font-medium text-arm-desc" title={WEIGHT_GROUPS[g]}>
                      {WEIGHT_GROUPS[g].split(":")[0]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {report.heat.rows.map((row) => (
                  <tr key={row.studentId}>
                    <td className="whitespace-nowrap p-1 font-medium">{shortName(row.name)}</td>
                    {row.cells.map((c) => (
                      <td
                        key={c.group}
                        className={`rounded p-1.5 text-center tabular-nums ${heatColor(c.rate)}`}
                        title={c.applicable ? `${c.failed} из ${c.applicable} ${plural(c.applicable, ["проверки", "проверок", "проверок"])} провалено` : "не проверялось"}
                      >
                        {c.rate == null ? "—" : `${c.rate} %`}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-arm-desc">
            Доля проваленных проверок в группе:
            <span className="rounded bg-emerald-50 px-1.5 text-emerald-800">0 %</span>
            <span className="rounded bg-amber-100 px-1.5 text-amber-900">до 33 %</span>
            <span className="rounded bg-orange-300 px-1.5 text-orange-950">34–66 %</span>
            <span className="rounded bg-red-600 px-1.5 text-white">67 % и выше</span>
            <span>«—» — не проверялось</span>
          </p>
        </Section>
      )}
    </div>
  );
}
