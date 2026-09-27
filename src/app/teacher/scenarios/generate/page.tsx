import { PageHeader } from "@/components/ui";
import { aiMode } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { candidateTypes, streetsIn } from "@/lib/scenarios/by-category";
import { CATEGORY_DEFS } from "@/lib/scenarios/categories";
import { groupLocations } from "@/lib/scenarios/location";
import { GenerateForm, type GenerateCategory } from "./GenerateForm";

export default async function GenerateByCategoryPage(props: PageProps<"/teacher/scenarios/generate">) {
  await requireUser(["TEACHER", "ADMIN"]);
  const sp = await props.searchParams;
  const asked = Array.isArray(sp.category) ? sp.category[0] : sp.category;
  const [types, groups, library] = await Promise.all([
    db.incidentType.findMany({
      select: { code: true, groupId: true, subgroup: true, finalType: true, sign1: true, sign2: true, sign3: true, questions: true, hiddenFromOperator: true },
    }),
    db.incidentGroup.findMany({ select: { id: true, name: true } }),
    db.scenario.groupBy({ by: ["category", "status"], where: { status: { not: "ARCHIVED" } }, _count: { _all: true } }),
  ]);
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const categories: GenerateCategory[] = CATEGORY_DEFS.map((def) => {
    const rows = library.filter((r) => r.category === def.name);
    return {
      name: def.name,
      groups: def.groups.map((id) => groupName.get(id) ?? `группа ${id}`),
      types: candidateTypes(def, types).length,
      total: rows.reduce((a, r) => a + r._count._all, 0),
      approved: rows.filter((r) => r.status === "APPROVED").reduce((a, r) => a + r._count._all, 0),
    };
  }).filter((c) => c.types > 0);
  const locations = groupLocations(streetsIn(null).map((p) => ({ okrug: p.okrug ?? null, district: p.district ?? null })));

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        back={{ href: "/teacher/scenarios", label: "Сценарии" }}
        title="Сценарии по категории"
        subtitle="Система берёт типы происшествий выбранной категории из классификатора и настоящие адреса выбранного округа или района. Рассказ заявителя пишет модель ИИ, службы, обязательные вопросы и эталон для ДДС подбирают правила. Всё попадёт в «Черновики» и пойдёт в занятия только после вашего утверждения."
      />
      <div className="rounded border border-arm-gray/70 bg-white p-4">
        <GenerateForm
          categories={categories}
          locations={locations}
          initialCategory={categories.find((c) => c.name === asked)?.name ?? categories[0]?.name ?? ""}
          aiMock={aiMode().llm === "mock"}
        />
      </div>
    </div>
  );
}
