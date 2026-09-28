import { notFound } from "next/navigation";
import Link from "next/link";
import { PassLine } from "@/components/pass";
import { Badge, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { studentFollowUps } from "@/lib/followup/student";
import { getStudentAttempt } from "@/lib/student/results";
import { viewerSession } from "@/lib/student/viewer";
import { WEIGHT_GROUPS, type WeightGroup } from "@/lib/scoring/score";

export default async function MyAttemptPage(props: PageProps<"/student/results/[id]">) {
  const user = await requireUser(["STUDENT"]);
  const { id } = await props.params;
  const a = await getStudentAttempt(user.id, id, await viewerSession());
  if (!a) notFound();
  const title = a.task ?? "Попытка";

  if (a.status === "PENDING") {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader back={{ href: "/student/results", label: "Мои результаты" }} title={title} subtitle={`${a.lessonTitle} · ${formatDateTime(a.createdAt)}`} />
        <Section>
          <Badge tone="amber">на проверке</Badge>
          <p className="mt-2 text-sm">Преподаватель ещё не проверил эту попытку. Балл и разбор появятся здесь после проверки.</p>
        </Section>
      </div>
    );
  }

  const followUps = await studentFollowUps(user.id, id);
  const groups = (Object.keys(WEIGHT_GROUPS) as WeightGroup[]).filter((g) => a.checks.some((c) => c.group === g));
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        back={{ href: "/student/results", label: "Мои результаты" }}
        title={title}
        subtitle={`${a.kind === "OP112" ? "Оператор 112" : "Диспетчер ДДС"} · ${a.lessonTitle} · ${formatDateTime(a.createdAt)}${a.incidentNumber ? ` · карточка № ${a.incidentNumber}` : ""}`}
        actions={
          <div className="text-right">
            <div className="text-xs text-arm-desc">Балл</div>
            <div className="text-3xl font-bold tabular-nums">{a.score ?? "—"}</div>
          </div>
        }
      />
      <Section>
        <PassLine verdict={a.pass} rules={a.passRules} />
      </Section>
      {a.feedback && (
        <Section title="Главное из разбора">
          <p className="text-sm">{a.feedback.summary}</p>
          {a.feedback.strength && <p className="mt-2 text-sm text-emerald-800">Получилось: {a.feedback.strength}</p>}
          {a.feedback.priority && (
            <div className="mt-3 rounded border border-arm-gray/70 bg-arm-panel p-3 text-sm">
              <p className="font-medium">
                {a.feedback.priority.title}
                {a.feedback.priority.critical && <Badge tone="red" className="ml-2">критично</Badge>}
              </p>
              {a.feedback.priority.evidence && <p className="mt-1 text-arm-desc">Основание: {a.feedback.priority.evidence}</p>}
              <p className="mt-2">В следующей ситуации: {a.feedback.priority.nextAction}</p>
            </div>
          )}
        </Section>
      )}
      {followUps.length > 0 && <Section title="Следующее упражнение">
        <ul className="space-y-2 text-sm">
          {followUps.map((f) => <li key={f.id} className="rounded border border-arm-gray/70 p-3">
            <b>{f.title}</b><span className="block text-arm-desc">{f.status}</span>
            {(f.state === "planned" || f.state === "practice" || f.state === "control_ready" || f.state === "control") &&
              <Link className="mt-1 inline-block text-arm-blue underline" href="/student">Открыть мои задания →</Link>}
          </li>)}
        </ul>
      </Section>}
      {a.teacherComment && (
        <Section title="Комментарий преподавателя">
          <p className="text-sm">{a.teacherComment}</p>
        </Section>
      )}
      {groups.map((g) => (
        <Section key={g} title={WEIGHT_GROUPS[g]}>
          <ul className="flex flex-col gap-2">
            {a.checks
              .filter((c) => c.group === g)
              .map((c) => (
                <li key={c.code} className="flex gap-2 text-sm">
                  <span className={`mt-0.5 font-bold ${c.ok === null ? "text-arm-desc" : c.ok ? "text-emerald-700" : "text-red-700"}`}>{c.ok === null ? "—" : c.ok ? "✓" : "✕"}</span>
                  <span>
                    <span className="font-medium">{c.title}</span>
                    {c.critical && c.ok === false && <Badge tone="red" className="ml-2">критично</Badge>}
                    {c.changedByTeacher && <span className="ml-2 text-xs text-arm-blue">исправлено преподавателем</span>}
                    {c.ok === false && c.evidence && <span className="block text-arm-desc">{c.evidence}</span>}
                    {c.ok === false && c.expected && <span className="block text-emerald-800">Как надо: {c.expected}</span>}
                  </span>
                </li>
              ))}
          </ul>
        </Section>
      ))}
    </div>
  );
}
