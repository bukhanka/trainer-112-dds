import { Badge, LinkButton, Section } from "@/components/ui";
import { formatTime, shortName } from "@/lib/format";
import { getAssignments, type Assignment } from "@/lib/student/assignments";

const ROLE = { OP112: "Оператор 112", DDS: "Диспетчер ДДС" } as const;

function whereCardsComeFrom(a: Assignment): string {
  const what = a.role === "OP112" ? "Вызовы" : "Карточки";
  if (a.from112 === "only") return "Карточки придут с мест операторов 112 этого занятия.";
  if (a.source === "level") return `Заданий нет: ${what.toLowerCase()} тренажёр подберёт по вашему уровню.`;
  if (a.source === "categories") return `Заданий нет: ${what.toLowerCase()} из категорий занятия — ${a.categories.join(", ")}.`;
  return `Заданий нет: ${what.toLowerCase()} из утверждённых сценариев.`;
}

/**
 * «Мои задания»: the places the teacher gave the student in a running or planned lesson and their tasks.
 * `empty` is the text for no places; without it an empty list renders nothing (the results page).
 */
export function MyTasks({ assignments, empty }: { assignments: Assignment[]; empty?: React.ReactNode }) {
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
              {a.tasks.length ? (
                <div className="mt-2">
                  <div className="text-xs text-arm-desc">
                    {a.role === "OP112" ? "Вызовы по заданиям" : "Карточки по заданиям"}, по порядку ({a.tasks.length}):
                  </div>
                  <ol className="mt-1 list-decimal space-y-0.5 pl-6 text-sm">
                    {a.tasks.map((t) => (
                      <li key={t.id}>
                        {t.title} <span className="text-xs text-arm-desc">· {t.category} · сложность {t.difficulty} из 10</span>
                      </li>
                    ))}
                  </ol>
                </div>
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
  return <MyTasks assignments={await getAssignments(studentId)} empty={empty} />;
}
