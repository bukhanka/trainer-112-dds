import { notFound } from "next/navigation";
import { Badge, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { formatAddress } from "@/lib/board/address";
import { PLATE_STATUS_LABEL } from "@/lib/board/state";
import { db } from "@/lib/db";
import { formatDateTime, formatDuration, formatTime } from "@/lib/format";
import { correctionsByIds } from "@/lib/review/corrections-db";
import { feedbackRevision } from "@/lib/review/published-feedback";
import { followUpCases, followUpCandidates } from "@/lib/followup/options";
import { studentFollowUps } from "@/lib/followup/student";
import { AssignFollowUp } from "@/app/teacher/followups/AssignFollowUp";
import { FollowUpProgress, type TeacherFollowUp } from "@/app/teacher/followups/FollowUpProgress";
import { readCriteria, readDraft, readOverrides } from "@/lib/review/draft";
import { RUNNING_LOCK } from "@/lib/review/review";
import { passRulesOf } from "@/lib/scoring/pass";
import { weightsForAttempt } from "@/lib/scoring/weights";
import { readWorkLog } from "@/lib/op112/workoffs";
import { attemptScope } from "@/lib/teacher/access";
import { AttemptReview, type LearnedView } from "./AttemptReview";

/** Which model wrote the draft is kept in the audit journal for the administrator, not shown in the cabinet. */
function withoutModel<T extends { model?: string }>(draft: T | null): T | null {
  if (!draft) return null;
  const rest = { ...draft };
  delete rest.model;
  return rest;
}

type Message = { role?: string; text?: string; at?: string };

export default async function AttemptPage(props: PageProps<"/teacher/attempts/[id]">) {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const { id } = await props.params;
  const attempt = await db.attempt.findFirst({
    where: { id, ...attemptScope(user) },
    include: {
      lesson: { select: { id: true, title: true, status: true, settings: true } },
      seat: { select: { label: true, service: { select: { shortName: true } } } },
      student: { select: { fullName: true } },
      scenario: { select: { title: true, category: true, difficulty: true } },
      reviewedBy: { select: { fullName: true } },
      incident: {
        select: { id: true, number: true, address: true, description: true, caller: true, createdAt: true, openedAt: true, savedAt: true, workLog: true },
      },
      incidentService: {
        select: {
          addedAt: true,
          crewNumber: true,
          service: { select: { shortName: true } },
          events: { orderBy: { at: "asc" }, select: { status: true, at: true, comment: true, actorLabel: true, late: true, crewNumber: true } },
        },
      },
    },
  });
  if (!attempt) notFound();

  const [siblings, weights, calls, cases, candidates, linked] = await Promise.all([
    db.attempt.findMany({ where: { lessonId: attempt.lessonId, reviewStatus: "PENDING" }, orderBy: { createdAt: "asc" }, select: { id: true, createdAt: true } }),
    weightsForAttempt(db, attempt.lessonId, attempt.studentId),
    attempt.kind === "OP112" && attempt.incidentId
      ? // The calls of this 112 place only: the caller and its calls to phone-only services, not the crews of the ДДС places.
        db.call.findMany({
          where: { incidentId: attempt.incidentId, seatId: attempt.seatId, kind: { in: ["CALLER_IN", "SERVICE_OUT"] } },
          orderBy: { startedAt: "asc" },
          select: { kind: true, messages: true, startedAt: true, counterpart: true },
        })
      : Promise.resolve([]),
    followUpCases(),
    followUpCandidates(attempt.lessonId, attempt.id),
    studentFollowUps(attempt.studentId, attempt.id),
  ]);
  // Teacher corrections the model checks of this attempt were shown (учёт правок).
  const criteria = readCriteria(attempt.criteria);
  const found = await correctionsByIds(criteria.flatMap((c) => c.learned ?? []));
  const learned: Record<string, LearnedView[]> = {};
  for (const c of criteria) {
    const list = (c.learned ?? []).flatMap((cid) => {
      const r = found.get(cid);
      return r ? [{ id: cid, typeName: r.typeName, draftOk: r.draftOk, teacherOk: r.teacherOk, comment: r.comment, authorName: r.authorName, when: formatDateTime(r.createdAt), active: r.active }] : [];
    });
    if (list.length) learned[c.code] = list;
  }
  const others = siblings.filter((s) => s.id !== attempt.id);
  const nextPending = others.find((s) => s.createdAt > attempt.createdAt) ?? others[0] ?? null;

  const progress: TeacherFollowUp[] = await Promise.all(linked.map(async (item) => {
    const [practiceLesson, controlLesson, later] = await Promise.all([
      db.lesson.findUniqueOrThrow({ where: { id: item.practiceLessonId }, select: { status: true } }),
      db.lesson.findUniqueOrThrow({ where: { id: item.controlLessonId }, select: { status: true } }),
      db.attempt.findMany({ where: { studentId: attempt.studentId, lessonId: { in: [item.practiceLessonId, item.controlLessonId] } }, orderBy: { createdAt: "desc" }, select: { id: true, lessonId: true, reviewStatus: true } }),
    ]);
    const stage = (lessonId: string, lessonStatus: string) => {
      const row = later.find((a) => a.lessonId === lessonId);
      return { lessonId, lessonStatus, attemptId: row?.id ?? null, checked: Boolean(row && row.reviewStatus !== "PENDING") };
    };
    return { id: item.id, title: item.title, state: item.state, status: item.status,
      practice: stage(item.practiceLessonId, practiceLesson.status), control: stage(item.controlLessonId, controlLesson.status), cancelled: item.state === "cancelled" };
  }));
  const caller = (attempt.incident?.caller ?? {}) as { fullName?: string; status?: string; aon?: string };
  const plate = attempt.incidentService;
  const kindLabel = attempt.kind === "OP112" ? "Оператор 112" : "Диспетчер ДДС";

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4">
      <PageHeader
        back={{ href: `/teacher/lessons/${attempt.lesson.id}/attempts`, label: `Попытки · ${attempt.lesson.title}` }}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {attempt.student.fullName}
            <Badge tone={attempt.kind === "OP112" ? "amber" : "blue"}>{kindLabel}</Badge>
          </span>
        }
        subtitle={
          <>
            {attempt.seat.label}
            {attempt.seat.service && <> · {attempt.seat.service.shortName}</>}
            {attempt.incident && <> · карточка № {attempt.incident.number}</>}
            {attempt.scenario && (
              <>
                {" "}
                · задание «{attempt.scenario.title}» ({attempt.scenario.category}, сложность {attempt.scenario.difficulty})
              </>
            )}{" "}
            · {formatDateTime(attempt.createdAt)}
          </>
        }
      />

      <AttemptReview
        key={`${attempt.reviewStatus}:${attempt.reviewedAt?.toISOString() ?? ""}:${feedbackRevision(readCriteria(attempt.criteria), attempt.aiDraft)}`}
        id={attempt.id}
        criteria={criteria}
        override={readOverrides(attempt.override)}
        draft={withoutModel(readDraft(attempt.aiDraft))}
        feedbackRevision={feedbackRevision(readCriteria(attempt.criteria), attempt.aiDraft)}
        reviewStatus={attempt.reviewStatus}
        teacherComment={attempt.teacherComment}
        reviewedBy={attempt.reviewedBy?.fullName ?? null}
        reviewedAt={attempt.reviewedAt ? formatDateTime(attempt.reviewedAt) : null}
        weights={weights}
        locked={attempt.lesson.status === "RUNNING" ? RUNNING_LOCK : null}
        nextPendingId={nextPending?.id ?? null}
        pass={passRulesOf(attempt.lesson.settings)}
        learned={learned}
      />

      {attempt.reviewStatus !== "PENDING" && <AssignFollowUp compact candidates={candidates.filter((c) => c.attemptId === attempt.id)} scenarios={cases} />}
      {progress.map((item) => <FollowUpProgress key={`${item.id}:${item.state}`} item={item} />)}

      <div className="grid gap-4 lg:grid-cols-2">
        {attempt.incident && (
          <Section title={`Карточка № ${attempt.incident.number}`}>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-arm-desc">Адрес</dt>
              <dd>{formatAddress(attempt.incident.address) ?? "—"}</dd>
              <dt className="text-arm-desc">Заявитель</dt>
              <dd>{[caller.fullName, caller.status, caller.aon].filter(Boolean).join(", ") || "—"}</dd>
              <dt className="text-arm-desc">Описание</dt>
              <dd>{attempt.incident.description ?? "—"}</dd>
              {attempt.kind === "OP112" && attempt.incident.savedAt && (
                <>
                  <dt className="text-arm-desc">Набор карточки</dt>
                  <dd>{formatDuration((attempt.incident.savedAt.getTime() - (attempt.incident.openedAt ?? attempt.incident.createdAt).getTime()) / 1000)}</dd>
                </>
              )}
              {attempt.kind === "OP112" && readWorkLog(attempt.incident.workLog).length > 0 && (
                <>
                  <dt className="text-arm-desc">Отработки</dt>
                  <dd>
                    {readWorkLog(attempt.incident.workLog).map((w) => (
                      <div key={w.id}>
                        {formatTime(w.at, true)} · {[w.service ?? w.where, w.phone, w.acceptedBy && `принял ${w.acceptedBy}`, w.summary].filter(Boolean).join(" · ")}
                      </div>
                    ))}
                  </dd>
                </>
              )}
            </dl>
          </Section>
        )}

        {plate && (
          <Section title={`Ход работы: ${plate.service.shortName}`}>
            <ol className="flex flex-col gap-1.5 text-sm">
              {plate.events.map((e, i) => (
                <li key={i} className="grid grid-cols-[4.5rem_3.5rem_1fr] gap-2">
                  <span className={`font-mono tabular-nums ${e.late ? "font-semibold text-arm-late" : "text-arm-desc"}`}>{formatTime(e.at, true)}</span>
                  <span className="text-xs tabular-nums text-arm-desc">+{formatDuration((e.at.getTime() - plate.addedAt.getTime()) / 1000)}</span>
                  <span>
                    <b>{PLATE_STATUS_LABEL[e.status]}</b>
                    {e.comment && <> — {e.comment}</>}
                    {e.crewNumber && <span className="text-xs text-arm-desc"> · наряд {e.crewNumber}</span>}
                    <span className="text-xs text-arm-desc"> · {e.actorLabel}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Section>
        )}

        {calls.map((c, i) => {
          const messages = (Array.isArray(c.messages) ? c.messages : []) as Message[];
          // A call from the work-off row: the other side is a service's duty dispatcher.
          const service = c.kind === "SERVICE_OUT" ? ((c.counterpart ?? {}) as { service?: string }).service ?? "служба" : null;
          return (
            <Section key={i} title={`${service ? `Звонок в службу: ${service}` : "Разговор с заявителем"} · ${formatTime(c.startedAt, true)}`}>
              {messages.length ? (
                <ol className="flex flex-col gap-1.5 text-sm">
                  {messages.map((m, j) => (
                    <li key={j} className={`max-w-[85%] rounded px-2 py-1 ${m.role === "trainee" ? "self-end bg-arm-blue/10" : "self-start bg-arm-panel"}`}>
                      <span className="block text-[11px] text-arm-desc">
                        {m.role === "trainee" ? "Оператор" : service ? "Дежурный" : "Заявитель"}
                        {m.at && <> · {formatTime(m.at, true)}</>}
                      </span>
                      {m.text}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-arm-desc">Расшифровки нет.</p>
              )}
            </Section>
          );
        })}
      </div>
    </div>
  );
}
