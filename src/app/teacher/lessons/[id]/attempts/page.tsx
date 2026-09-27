import Link from "next/link";
import { notFound } from "next/navigation";
import { PassBadge } from "@/components/pass";
import { Badge, Empty, PageHeader, REVIEW_STATUS } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatTime } from "@/lib/format";
import { listLessonAttempts } from "@/lib/review/list";
import { passRulesOf } from "@/lib/scoring/pass";
import { findLesson } from "@/lib/teacher/access";

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
        subtitle="ИИ и правила готовят черновик оценки. В зачёт и в отчёты попытка идёт только после вашего решения: «Верно» или «ИИ неправ»."
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
        <ul className="divide-y divide-arm-gray/50 rounded border border-arm-gray/70 bg-white">
          {attempts.map((a) => {
            const st = REVIEW_STATUS[a.reviewStatus];
            return (
              <li key={a.id}>
                <Link href={`/teacher/attempts/${a.id}`} className="grid gap-x-4 gap-y-1 px-3 py-2.5 text-sm hover:bg-arm-panel/60 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_6rem_7rem_9rem] sm:items-center">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{a.student}</div>
                    <div className="text-xs text-arm-desc">
                      {a.seat} · {a.kind === "OP112" ? "112" : "ДДС"} · {formatTime(a.createdAt)}
                    </div>
                  </div>
                  <div className="min-w-0 truncate">
                    {a.incidentNumber && <span className="text-xs text-arm-desc">№ <span className="font-mono">{a.incidentNumber}</span> · </span>}
                    {a.scenario ?? "Карточка"}
                  </div>
                  <div className={a.failed ? "font-medium text-red-700" : "text-emerald-700"}>
                    {a.failed ? `ошибок ${a.failed}` : "без ошибок"}
                    {a.critical && <span className="block text-xs">критичная</span>}
                  </div>
                  <div className="tabular-nums">
                    {a.score == null ? "—" : a.reviewStatus === "PENDING" ? <span className="text-arm-desc">{a.score} (черновик)</span> : <b>{a.score}</b>}
                    <span className="block">
                      <PassBadge verdict={a.pass} draft={a.reviewStatus === "PENDING"} />
                    </span>
                  </div>
                  <div>
                    <Badge tone={st.tone}>{st.label}</Badge>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>{status === "PENDING" ? "Все попытки проверены." : "Попыток с такими условиями нет."}</Empty>
      )}
    </div>
  );
}
