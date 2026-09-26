import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { defaultTeacherSettings } from "@/lib/lessons/defaults";
import { loadLessonFormOptions } from "@/lib/lessons/options";
import { LessonForm } from "../LessonForm";

export default async function NewLessonPage() {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const [options, defaults] = await Promise.all([loadLessonFormOptions(user), defaultTeacherSettings()]);
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Новое занятие" back={{ href: "/teacher", label: "Занятия" }} subtitle="Группа, настройки, места и задания. Старт — на экране занятия." />
      <LessonForm options={options} defaults={defaults} />
    </div>
  );
}
