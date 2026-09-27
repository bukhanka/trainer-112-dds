import Link from "next/link";
import { BarChart } from "@/components/charts";
import { Badge, Empty, PageHeader, Section, Stat } from "@/components/ui";
import { getStudentForecast } from "@/lib/adaptive/student";
import { requireUser } from "@/lib/auth/session";
import { formatDate, formatDateTime } from "@/lib/format";
import { getStudentResults } from "@/lib/student/results";
import { viewerSession } from "@/lib/student/viewer";
import { MyTasksSection } from "../MyTasks";
import { MyForecast } from "./MyForecast";
import { MyReactionSection } from "./MyReaction";

export default async function MyResultsPage() {
  const user = await requireUser(["STUDENT"]);
  const viewer = await viewerSession();
  const [r, forecast] = await Promise.all([getStudentResults(user.id, viewer), getStudentForecast(user.id, viewer)]);
  const s = r.summary;
  const trend = s.lastLesson != null && s.prevLesson != null ? s.lastLesson - s.prevLesson : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <PageHeader title="Мои результаты" subtitle="Оценка появляется после проверки преподавателем. До этого попытка — «на проверке»." />

      <MyTasksSection studentId={user.id} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Проверено попыток" value={s.reviewed} hint={s.pending ? `ещё ${s.pending} на проверке` : undefined} />
        <Stat label="Средний балл (0–100)" value={s.avgScore ?? "—"} />
        <Stat
          label="Последнее занятие"
          value={s.lastLesson ?? "—"}
          tone={trend == null ? undefined : trend >= 0 ? "green" : "red"}
          hint={trend == null ? undefined : `${trend >= 0 ? "+" : "−"}${Math.abs(trend)} к прошлому занятию`}
        />
        <Stat label="Всего попыток" value={s.total} />
      </div>

      <MyForecast view={forecast} />

      <MyReactionSection studentId={user.id} viewer={viewer} />

      <Section title="Прогресс по занятиям">
        {r.progress.length ? (
          <>
            <BarChart
              unit=""
              max={100}
              labelWidth="13rem"
              bars={r.progress.map((p) => ({
                key: p.lessonId,
                label: `${formatDate(p.date)} · ${p.title}`,
                title: p.title,
                value: p.avgScore,
                valueLabel: `${p.avgScore} (${p.attempts})`,
                tone: p.avgScore >= 70 ? "green" : p.avgScore >= 50 ? "amber" : "red",
              }))}
            />
            <p className="mt-2 text-xs text-arm-desc">Средний балл проверенных попыток занятия, шкала 0–100; в скобках — число попыток.</p>
          </>
        ) : (
          <p className="text-sm text-arm-desc">Проверенных попыток пока нет.</p>
        )}
      </Section>

      <Section title="Что подтянуть">
        {r.recommendations.length ? (
          <ul className="grid gap-3 md:grid-cols-3">
            {r.recommendations.map((rec) => (
              <li key={rec.group} className="rounded border border-arm-gray/70 p-3 text-sm">
                <div className="font-semibold">{rec.title}</div>
                <div className="mb-1 text-xs text-red-700">ошибок: {rec.failed}</div>
                <p>{rec.advice}</p>
                {rec.examples.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-arm-desc">
                    {rec.examples.map((e) => (
                      <li key={e}>{e}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-arm-desc">{s.reviewed ? "Ошибок в проверенных попытках нет — так держать." : "Рекомендации появятся после проверки попыток."}</p>
        )}
      </Section>

      <Section title="Попытки">
        {r.attempts.length ? (
          <ul className="divide-y divide-arm-gray/50">
            {r.attempts.map((a) => (
              <li key={a.id}>
                <Link href={`/student/results/${a.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 text-sm hover:bg-arm-panel/50">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{a.task ?? (a.incidentNumber ? `Карточка № ${a.incidentNumber}` : "Карточка")}</span>
                    <span className="block text-xs text-arm-desc">
                      {a.kind === "OP112" ? "Оператор 112" : "Диспетчер ДДС"} · {a.lessonTitle} · {formatDateTime(a.createdAt)}
                    </span>
                  </span>
                  {a.status === "PENDING" ? (
                    <Badge tone="amber">на проверке</Badge>
                  ) : (
                    <>
                      <span className={a.failed ? "text-red-700" : "text-emerald-700"}>{a.failed ? `ошибок ${a.failed}` : "без ошибок"}</span>
                      <span className="w-16 text-right text-lg font-semibold tabular-nums">{a.score ?? "—"}</span>
                    </>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <Empty>Попыток пока нет. Они появятся после первого занятия.</Empty>
        )}
      </Section>
    </div>
  );
}
