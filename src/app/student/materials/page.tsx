import { byLesson, MaterialList } from "@/components/materials";
import { Badge, Empty, LESSON_STATUS, PageHeader, Section } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { listMaterials } from "@/lib/materials/service";

/** Materials for the student: the ones for everybody and the ones of the student's lessons — nothing else reaches here. */
export default async function StudentMaterialsPage() {
  const user = await requireUser(["STUDENT"]);
  const items = await listMaterials(user);
  const general = items.filter((m) => m.audience === "all");
  const lessons = byLesson(items).filter((g) => g.lesson);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <PageHeader title="Материалы" subtitle="Памятки, инструкции и методички от преподавателей: общие и к вашим занятиям. PDF, текст и рисунки открываются в браузере, остальное — скачивается." />
      {!items.length ? (
        <Empty>Преподаватели ещё не добавили материалы.</Empty>
      ) : (
        <>
          {lessons.map((g) => (
            <Section
              key={g.key}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  К занятию «{g.lesson!.title}»
                  {LESSON_STATUS[g.lesson!.status] && <Badge tone={LESSON_STATUS[g.lesson!.status].tone}>{LESSON_STATUS[g.lesson!.status].label}</Badge>}
                </span>
              }
            >
              <MaterialList items={g.items} />
            </Section>
          ))}
          {general.length > 0 && (
            <Section title="Для всех обучающихся">
              <MaterialList items={general} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}
