import { Badge, LinkButton, Section } from "@/components/ui";
import { studentFollowUps } from "@/lib/followup/student";
import { countLabel, formatTime, shortName } from "@/lib/format";
import { getAssignments, type Assignment } from "@/lib/student/assignments";

const ROLE = { OP112: "Оператор 112", DDS: "Диспетчер ДДС" } as const;

function whereCardsComeFrom(a: Assignment): string {
  const what = a.role === "OP112" ? "вызовы" : "карточки";
  if (a.from112 === "only") return "Карточки придут с мест операторов 112 этого занятия.";
  if (a.source === "level") return `Заданий нет: ${what} тренажёр подберёт по вашему уровню.`;
  if (a.source === "categories") return `Заданий нет: ${what} — из категорий, которые выбрал преподаватель.`;
  return `Заданий нет: ${what} — из утверждённых сценариев.`;
}

/**
 * Only how many: the title or the category of a task would tell the operator what happened before the caller
 * says it, and the dispatcher what is in the card before it comes.
 */
function tasksLine(a: Assignment): string {
  if (a.role === "OP112") {
    return `${countLabel(a.taskCount, ["вызов", "вызова", "вызовов"])} по заданиям преподавателя. Что случилось, расскажет заявитель — как на настоящем вызове.`;
  }
  return `${countLabel(a.taskCount, ["карточка", "карточки", "карточек"])} по заданиям преподавателя. Что в карточке, вы увидите, когда она придёт в ленту.`;
}

/**
 * «Мои задания»: the places the teacher gave the student in a running or planned lesson and their tasks.
 * `empty` is the text for no places; without it an empty list renders nothing (the results page).
 */
export function MyTasks({ assignments, empty, stages = {} }: { assignments: Assignment[]; empty?: React.ReactNode; stages?: Record<string, { title: string; status: string; hints: boolean }> }) {
  if (!assignments.length && !empty) return null;
  return (
    <Section title="Мои задания">
      {assignments.length ? (
        <ul className="flex flex-col gap-3">
          {assignments.map((a) => (
            <li key={a.lessonId} className={`rounded border p-3 ${a.status === "RUNNING" ? "border-emerald-300 bg-emerald-50/40" : "border-arm-gray/70"}`}>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {a.status === "RUNNING" ? <Badge tone="green">идёт{a.startedAt ? ` с ${formatTime(a.startedAt)}` : ""}</Badge> : <Badge>запланировано</Badge>}
                    <span className="font-semibold">{a.lessonTitle}</span>
                  </div>
                  <div className="mt-1 text-sm">
                    Ваше место: <b>{ROLE[a.role]}</b>
                    {a.serviceName ? ` · служба «${a.serviceName}»` : ""}
                    {a.seatLabel ? ` · ${a.seatLabel}` : ""}
                  </div>
                  <div className="text-xs text-arm-desc">
                    {[a.groupName, `преподаватель ${shortName(a.teacherName)}`].filter(Boolean).join(" · ")}
                  </div>
                </div>
                {a.status === "RUNNING" ? (
                  <LinkButton href={a.role === "OP112" ? "/op112" : "/dds"} variant="success">
                    Перейти на место →
                  </LinkButton>
                ) : (
                  <span className="text-xs text-arm-desc sm:max-w-60">Место откроется, когда преподаватель начнёт занятие.</span>
                )}
              </div>
              {stages[a.lessonId] && <p className="mt-2 text-sm"><b>{stages[a.lessonId].title}</b> · {stages[a.lessonId].status} · {stages[a.lessonId].hints ? "подсказки включены" : "контроль без подсказок"}</p>}
              {a.taskCount ? (
                <p className="mt-2 text-sm">{tasksLine(a)}</p>
              ) : (
                <p className="mt-2 text-sm text-arm-desc">{whereCardsComeFrom(a)}</p>
              )}
              {a.from112 === "also" && <p className="mt-1 text-xs text-arm-desc">Кроме того, карточки придут с мест операторов 112 этого занятия.</p>}
            </li>
          ))}
        </ul>
      ) : (
        <div className="text-sm text-arm-desc">{empty}</div>
      )}
    </Section>
  );
}

/** The section with its own data: on the results page it shows only while something is assigned. */
export async function MyTasksSection({ studentId, empty }: { studentId: string; empty?: React.ReactNode }) {
  const [assignments, links] = await Promise.all([getAssignments(studentId), studentFollowUps(studentId)]);
  const stages: Record<string, { title: string; status: string; hints: boolean }> = {};
  for (const f of links) {
    if (f.state === "cancelled" || f.state === "source_changed") continue;
    stages[f.practiceLessonId] = { title: f.title, status: f.status, hints: true };
    stages[f.controlLessonId] = { title: f.title, status: f.status, hints: false };
  }
  return <MyTasks assignments={assignments} stages={stages} empty={empty} />;
}
