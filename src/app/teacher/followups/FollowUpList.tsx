import Link from "next/link";
import { Badge, Section } from "@/components/ui";
import type { TeacherFollowUp } from "@/lib/followup/teacher";

const LESSON = { DRAFT: "ждёт запуска", RUNNING: "идёт", FINISHED: "завершено" } as const;

/**
 * Follow-ups of a lesson on one screen: who got which goal, where the two lessons are and what is next. The route
 * itself — observations, repeating a stage, cancelling — is on the page of the student's error.
 */
export function FollowUpList({ items, title, note }: { items: TeacherFollowUp[]; title: string; note?: string }) {
  if (!items.length) return null;
  return <Section title={title} className="print:hidden">
    {note && <p className="mb-2 text-sm text-arm-desc">{note}</p>}
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs text-arm-desc">
          <tr>
            <th className="py-1 pr-3 font-medium">Ученик</th>
            <th className="py-1 pr-3 font-medium">Цель и состояние</th>
            <th className="py-1 pr-3 font-medium">Отработка</th>
            <th className="py-1 pr-3 font-medium">Контроль</th>
            <th className="py-1 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-arm-gray/50">
          {items.map((f) => <tr key={f.id} className="align-top">
            <td className="py-1.5 pr-3">{f.studentName}</td>
            <td className="py-1.5 pr-3">
              {f.title}
              <span className="mt-0.5 block"><Badge tone={f.state === "achieved" ? "green" : f.state === "not_achieved" ? "red" : f.state.endsWith("_missed") ? "amber" : "neutral"}>{f.status}</Badge></span>
            </td>
            <td className="py-1.5 pr-3"><Link className="text-arm-blue underline" href={`/teacher/lessons/${f.practice.lessonId}`}>{f.practice.lessonTitle}</Link>
              <span className="block text-xs text-arm-desc">{LESSON[f.practice.lessonStatus]}{f.practice.scenarioTitle ? ` · «${f.practice.scenarioTitle}»` : ""}</span></td>
            <td className="py-1.5 pr-3"><Link className="text-arm-blue underline" href={`/teacher/lessons/${f.control.lessonId}`}>{f.control.lessonTitle}</Link>
              <span className="block text-xs text-arm-desc">{LESSON[f.control.lessonStatus]}{f.control.scenarioTitle ? ` · «${f.control.scenarioTitle}»` : ""}</span></td>
            <td className="whitespace-nowrap py-1.5"><Link className="text-arm-blue underline" href={`/teacher/attempts/${f.sourceAttemptId}#followup`}>Назначение и история →</Link></td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </Section>;
}
