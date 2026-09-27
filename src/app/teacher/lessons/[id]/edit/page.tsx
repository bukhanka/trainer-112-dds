import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { defaultTeacherSettings } from "@/lib/lessons/defaults";
import { parseTeacherSettings } from "@/lib/lessons/form";
import { loadLessonFormOptions } from "@/lib/lessons/options";
import { findLesson } from "@/lib/teacher/access";
import { GROUP_ARCHIVED, lessonGroupProblem } from "@/lib/teacher/groups";
import { LessonForm } from "../../LessonForm";

export default async function EditLessonPage(props: PageProps<"/teacher/lessons/[id]/edit">) {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const { id } = await props.params;
  const lesson = await findLesson(user, id);
  if (!lesson) notFound();
  if (lesson.status !== "DRAFT") redirect(`/teacher/lessons/${id}`);

  const [options, defaults, seats, groupProblem] = await Promise.all([
    loadLessonFormOptions(user),
    defaultTeacherSettings(),
    db.seat.findMany({ where: { lessonId: id }, orderBy: { createdAt: "asc" } }),
    lessonGroupProblem(user, lesson.groupId),
  ]);
  // The lesson's group went to the archive or to another teacher: say so, and offer an own active group instead.
  const groupId = groupProblem ? (options.groups[0]?.id ?? "") : (lesson.groupId ?? "");
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={`Изменить: ${lesson.title}`} back={{ href: `/teacher/lessons/${id}`, label: "К занятию" }} />
      {groupProblem && (
        <p role="alert" className="mb-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          {groupProblem === GROUP_ARCHIVED ? "Группа этого занятия в архиве — верните её в разделе " : `${groupProblem} Группы — в разделе `}
          <Link href="/teacher/groups" className="font-semibold underline">
            «Группы»
          </Link>
          {groupProblem === GROUP_ARCHIVED ? " или выберите другую группу ниже." : "."}
        </p>
      )}
      <LessonForm
        options={options}
        defaults={defaults}
        initial={{
          id,
          title: lesson.title,
          groupId,
          settings: parseTeacherSettings(lesson.settings),
          seats: seats.map((s) => ({ studentId: s.studentId, role: s.role, serviceId: s.serviceId, scenarioIds: s.scenarioIds, label: s.label })),
        }}
      />
    </div>
  );
}
