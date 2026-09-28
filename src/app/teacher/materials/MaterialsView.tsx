import Link from "next/link";
import { byLesson, MaterialList } from "@/components/materials";
import { Badge, Empty, LESSON_STATUS, PageHeader, Section } from "@/components/ui";
import type { SessionUser } from "@/lib/auth/session";
import { ACCEPTED_EXTS, ACCEPTED_LIST } from "@/lib/files/detect";
import { lessonChoices, listMaterials, MAX_FILE_MB, type MaterialItem } from "@/lib/materials/service";
import { DeleteMaterial } from "./DeleteMaterial";
import { UploadForm } from "./UploadForm";

const remove = (m: MaterialItem) => (m.canDelete ? <DeleteMaterial id={m.id} title={m.title} /> : null);

/**
 * «Материалы» of a teacher (own lessons, all shared ones) and of an administrator (everything): the upload form and
 * the library by audience. Used by /teacher/materials and /admin/materials; each page checks the role itself.
 */
export async function MaterialsView({ user }: { user: SessionUser }) {
  const [items, lessons] = await Promise.all([listMaterials(user), lessonChoices(user)]);
  const general = items.filter((m) => m.audience === "all");
  const staff = items.filter((m) => m.audience === "staff");
  const lessonGroups = byLesson(items);
  const lessonCount = lessonGroups.reduce((n, g) => n + g.items.length, 0);
  const options = lessons.map((l) => ({
    id: l.id,
    label: [l.title, l.groupName ?? "без группы", LESSON_STATUS[l.status]?.label.toLowerCase()].filter(Boolean).join(" · "),
  }));

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4">
      <PageHeader
        title="Материалы"
        subtitle="Методички, инструкции, таблицы и схемы. Ученики видят материалы для всех и материалы своих занятий; «только преподавателям» — не видят. Сценарии из новых билетов — в «Сценарии» → «Сценарий из текста или билета»."
      />
      <Section title="Загрузить материал">
        <UploadForm lessons={options} maxMb={MAX_FILE_MB} accept={ACCEPTED_EXTS.join(",")} kinds={ACCEPTED_LIST} />
      </Section>

      {items.length === 0 ? (
        <Empty>Материалов пока нет. Загрузите первый — например, памятку диспетчера ДДС в PDF или таблицу позывных в Excel.</Empty>
      ) : (
        <>
          <Section title={`Всем обучающимся · ${general.length}`}>
            {general.length ? <MaterialList items={general} action={remove} /> : <p className="text-sm text-arm-desc">Нет материалов для всех.</p>}
          </Section>
          <Section title={`К занятиям · ${lessonCount}`}>
            {lessonGroups.length ? (
              <div className="flex flex-col gap-4">
                {lessonGroups.map((g) => (
                  <div key={g.key} className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      {g.lesson ? (
                        <>
                          <Link href={`/teacher/lessons/${g.lesson.id}`} className="font-medium text-arm-blue hover:underline">
                            {g.lesson.title}
                          </Link>
                          {LESSON_STATUS[g.lesson.status] && <Badge tone={LESSON_STATUS[g.lesson.status].tone}>{LESSON_STATUS[g.lesson.status].label}</Badge>}
                        </>
                      ) : (
                        <span className="text-amber-800">Занятие удалено — ученики эти материалы не видят. Удалите их или загрузите заново к другому занятию</span>
                      )}
                    </div>
                    <MaterialList items={g.items} action={remove} />
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-arm-desc">Нет материалов к занятиям.</p>
            )}
          </Section>
          <Section title={`Только преподавателям · ${staff.length}`}>
            {staff.length ? <MaterialList items={staff} action={remove} /> : <p className="text-sm text-arm-desc">Нет материалов только для преподавателей.</p>}
          </Section>
        </>
      )}
    </div>
  );
}
