import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { NewScenarioForm } from "./NewScenarioForm";

export default async function NewScenarioPage() {
  await requireUser(["TEACHER", "ADMIN"]);
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <PageHeader
        back={{ href: "/teacher/scenarios", label: "Сценарии" }}
        title="Сценарий из текста"
        subtitle="Опишите ситуацию или загрузите файл билета — система соберёт черновик: заявитель с фактами «только на вопрос», тип происшествия по классификатору, службы по правилам подбора, эталон для мест ДДС. Черновик попадёт в занятие только после вашего утверждения."
      />
      <div className="rounded border bg-white p-4">
        <NewScenarioForm />
      </div>
    </div>
  );
}
