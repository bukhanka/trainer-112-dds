import { notFound, redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { defaultTeacherSettings } from "@/lib/lessons/defaults";
import { parseTeacherSettings } from "@/lib/lessons/form";
import { loadLessonFormOptions } from "@/lib/lessons/options";
import { findLesson } from "@/lib/teacher/access";
import { LessonForm } from "../../LessonForm";

export default async function EditLessonPage(props: PageProps<"/teacher/lessons/[id]/edit">) {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const { id } = await props.params;
  const lesson = await findLesson(user, id);
  if (!lesson) notFound();
  if (lesson.status !== "DRAFT") redirect(`/teacher/lessons/${id}`);

  const [options, defaults, seats] = await Promise.all([
    loadLessonFormOptions(user),
    defaultTeacherSettings(),
    db.seat.findMany({ where: { lessonId: id }, orderBy: { createdAt: "asc" } }),
  ]);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={`Изменить: ${lesson.title}`} back={{ href: `/teacher/lessons/${id}`, label: "К занятию" }} />
      <LessonForm
        options={options}
        defaults={defaults}
        initial={{
          id,
          title: lesson.title,
          groupId: lesson.groupId ?? "",
          settings: parseTeacherSettings(lesson.settings),
          seats: seats.map((s) => ({ studentId: s.studentId, role: s.role, serviceId: s.serviceId, scenarioIds: s.scenarioIds, label: s.label })),
        }}
      />
    </div>
  );
}
