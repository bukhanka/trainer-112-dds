import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty, PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatTime } from "@/lib/format";
import { listLessonAttempts } from "@/lib/review/list";
import { passRulesOf } from "@/lib/scoring/pass";
import { findLesson } from "@/lib/teacher/access";
import { AttemptList } from "./AttemptList";

const STATUS_TABS = [
  { value: "PENDING", label: "На проверке" },
  { value: "CONFIRMED", label: "Подтверждены" },
  { value: "OVERRIDDEN", label: "Исправлены" },
  { value: "", label: "Все" },
];

const KIND_TABS = [
  { value: "", label: "Все места" },
  { value: "OP112", label: "112" },
  { value: "DDS", label: "ДДС" },
];

export default async function LessonAttemptsPage(props: PageProps<"/teacher/lessons/[id]/attempts">) {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const { id } = await props.params;
  const lesson = await findLesson(user, id);
  if (!lesson) notFound();
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const status = one(sp.status);
  const kind = one(sp.kind);
  const seat = one(sp.seat);

  const [attempts, counts, seatRow] = await Promise.all([
    listLessonAttempts(id, { status, kind, seat }, passRulesOf(lesson.settings)),
    db.attempt.groupBy({ by: ["reviewStatus"], where: { lessonId: id }, _count: { _all: true } }),
    seat ? db.seat.findFirst({ where: { id: seat, lessonId: id }, select: { label: true, student: { select: { fullName: true } } } }) : null,
  ]);
  const count = (s: string) => (s ? (counts.find((c) => c.reviewStatus === s)?._count._all ?? 0) : counts.reduce((a, c) => a + c._count._all, 0));
  const href = (patch: Record<string, string>) => {
    const q = new URLSearchParams({ status, kind, seat, ...patch });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    const s = q.toString();
    return `/teacher/lessons/${id}/attempts${s ? `?${s}` : ""}`;
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <PageHeader
        back={{ href: `/teacher/lessons/${id}`, label: lesson.title }}
        title="Проверка попыток"
        subtitle="ИИ и правила готовят черновик оценки. В зачёт и в отчёты попытка идёт только после вашего решения: «Верно» или «ИИ неправ». С черновиками, где вы согласны, — «Утвердить выбранные» или «Утвердить все без критичных ошибок»."
      />
      {lesson.status === "RUNNING" && (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Занятие идёт — черновики можно смотреть, а подтверждать оценки можно после его окончания.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex flex-wrap gap-1" aria-label="Статус проверки">
          {STATUS_TABS.map((t) => (
            <Link
              key={t.value}
              href={href({ status: t.value })}
              className={`rounded border px-3 py-1.5 text-sm ${status === t.value ? "border-arm-dark bg-arm-dark text-white" : "border-arm-gray bg-white hover:border-arm-blue"}`}
            >
              {t.label} <span className="tabular-nums opacity-70">{count(t.value)}</span>
            </Link>
          ))}
        </nav>
        <nav className="flex flex-wrap gap-1" aria-label="Роль места">
          {KIND_TABS.map((t) => (
            <Link
              key={t.value}
              href={href({ kind: t.value })}
              className={`rounded border px-3 py-1.5 text-sm ${kind === t.value ? "border-arm-blue bg-arm-blue text-white" : "border-arm-gray bg-white hover:border-arm-blue"}`}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        {seatRow && (
          <Link href={href({ seat: "" })} className="rounded border border-arm-blue bg-arm-blue/10 px-3 py-1.5 text-sm text-arm-blue">
            {seatRow.label} · {seatRow.student.fullName} ✕
          </Link>
        )}
      </div>

      {attempts.length ? (
        <AttemptList
          lessonId={id}
          canDecide={lesson.status !== "RUNNING"}
          rows={attempts.map((a) => ({
            id: a.id,
            kind: a.kind,
            student: a.student,
            seat: a.seat,
            time: formatTime(a.createdAt),
            scenario: a.scenario,
            incidentNumber: a.incidentNumber,
            reviewStatus: a.reviewStatus,
            score: a.score,
            failed: a.failed,
            critical: a.critical,
            edited: a.edited,
            pass: a.pass,
          }))}
        />
      ) : (
        <Empty>{status === "PENDING" ? "Все попытки проверены." : "Попыток с такими условиями нет."}</Empty>
      )}
    </div>
  );
}
