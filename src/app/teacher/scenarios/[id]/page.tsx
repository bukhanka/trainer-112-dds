import { notFound } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { aiMode } from "@/lib/ai/provider";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/format";
import { placeLabel } from "@/lib/scenarios/location";
import { scenarioLockedBy } from "@/lib/scenarios/lock";
import { scenarioPlace } from "@/lib/scenarios/place";
import { presentSections } from "@/lib/scenarios/sections";
import { ScenarioEditor } from "./ScenarioEditor";

export default async function ScenarioPage(props: PageProps<"/teacher/scenarios/[id]">) {
  await requireUser(["TEACHER", "ADMIN"]);
  const { id } = await props.params;
  const s = await db.scenario.findUnique({ where: { id } });
  if (!s) notFound();
  const [lockedBy, categories] = await Promise.all([
    scenarioLockedBy(s),
    db.scenario.findMany({ distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
  ]);
  const source = s.ticketRef ? `билет ${s.ticketRef}` : s.source === "generated" ? "сгенерирован ИИ" : "составлен преподавателем";
  const place = placeLabel(scenarioPlace(s.truth)) || "район не определён";

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader back={{ href: "/teacher/scenarios", label: "Сценарии" }} title={s.title} subtitle={`${source} · ${place} · изменён ${formatDateTime(s.updatedAt)}`} />
      <ScenarioEditor
        s={{
          id: s.id,
          title: s.title,
          category: s.category,
          difficulty: s.difficulty,
          status: s.status,
          approvedSections: s.approvedSections,
          present: presentSections(s),
          caller: s.caller,
          truth: s.truth,
          ddsCard: s.ddsCard,
          ddsReference: s.ddsReference,
          teacherNote: s.teacherNote,
        }}
        lockedBy={lockedBy}
        aiMock={aiMode().llm === "mock"}
        categories={categories.map((c) => c.category)}
      />
    </div>
  );
}
