import Link from "next/link";
import { Badge, Empty, PageHeader, buttonClass, fieldClass } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { listScenarios } from "@/lib/scenarios/list";
import { encodeLocation, groupLocations } from "@/lib/scenarios/location";
import { scenarioPlace } from "@/lib/scenarios/place";

const STATUS = { DRAFT: { label: "Черновик", tone: "amber" }, APPROVED: { label: "Утверждён", tone: "green" }, ARCHIVED: { label: "В архиве", tone: "neutral" } } as const;
const TABS = [
  { value: "", label: "Все рабочие" },
  { value: "DRAFT", label: "Черновики" },
  { value: "APPROVED", label: "Утверждённые" },
  { value: "ARCHIVED", label: "Архив" },
];

export default async function ScenariosPage(props: PageProps<"/teacher/scenarios">) {
  await requireUser(["TEACHER", "ADMIN"]);
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const status = one(sp.status);
  const category = one(sp.category);
  const q = one(sp.q);
  const loc = one(sp.loc);
  const [rows, counts, categories, addresses] = await Promise.all([
    listScenarios({ status, category, q, loc }),
    db.scenario.groupBy({ by: ["status"], _count: { _all: true } }),
    db.scenario.findMany({ distinct: ["category"], select: { category: true }, orderBy: { category: "asc" } }),
    db.scenario.findMany({ where: { status: { not: "ARCHIVED" } }, select: { truth: true } }),
  ]);
  const locations = groupLocations(addresses.map((s) => scenarioPlace(s.truth)));
  const count = (s: string) => (s ? (counts.find((c) => c.status === s)?._count._all ?? 0) : counts.filter((c) => c.status !== "ARCHIVED").reduce((a, c) => a + c._count._all, 0));
  const href = (patch: Record<string, string>) => {
    const p = new URLSearchParams({ status, category, q, loc, ...patch });
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/teacher/scenarios${p.size ? `?${p}` : ""}`;
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <PageHeader
        title="Сценарии"
        subtitle="Всё, что сгенерировано, — черновик. В занятие попадают только утверждённые сценарии: целиком или раздел за разделом."
        actions={
          <>
            <Link href={`/teacher/scenarios/generate${category ? `?category=${encodeURIComponent(category)}` : ""}`} className={buttonClass("primary")}>
              Сгенерировать по категории
            </Link>
            <Link href="/teacher/scenarios/new" className={buttonClass("primary")}>
              + Сценарий из текста
            </Link>
          </>
        }
      />
      <div className="flex flex-wrap items-end gap-2">
        <nav className="flex flex-wrap gap-1" aria-label="Статус">
          {TABS.map((t) => (
            <Link
              key={t.value}
              href={href({ status: t.value })}
              className={`rounded border px-3 py-1.5 text-sm ${status === t.value ? "border-arm-dark bg-arm-dark text-white" : "border-arm-gray bg-white hover:border-arm-blue"}`}
            >
              {t.label} <span className="tabular-nums opacity-70">{count(t.value)}</span>
            </Link>
          ))}
        </nav>
        <form className="ml-auto flex flex-wrap gap-2" action="/teacher/scenarios">
          {status && <input type="hidden" name="status" value={status} />}
          <select name="category" defaultValue={category} className={`${fieldClass} h-10 w-full sm:w-48`} aria-label="Категория">
            <option value="">Все категории</option>
            {categories.map((c) => (
              <option key={c.category} value={c.category}>
                {c.category}
              </option>
            ))}
          </select>
          <select name="loc" defaultValue={loc} className={`${fieldClass} h-10 w-full sm:w-56`} aria-label="Локация">
            <option value="">Все округа и районы</option>
            {locations.map((g) => (
              <optgroup key={g.okrug} label={g.okrug === "МО" ? "Московская область" : g.okrug}>
                <option value={encodeLocation({ okrug: g.okrug })}>
                  {g.okrug === "МО" ? "Московская область" : `${g.okrug} — весь округ`} ({g.count})
                </option>
                {g.districts.map((d) => (
                  <option key={d.name} value={encodeLocation({ okrug: g.okrug, district: d.name })}>
                    {d.name} ({d.count})
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <input name="q" defaultValue={q} placeholder="Название или билет" className={`${fieldClass} h-10 w-full sm:w-48`} aria-label="Поиск" />
          <button className="h-10 rounded border border-arm-gray bg-white px-3 text-sm hover:border-arm-blue">Найти</button>
        </form>
      </div>

      {rows.length ? (
        <ul className="divide-y divide-arm-gray/50 rounded border border-arm-gray/70 bg-white">
          {rows.map((s) => {
            const st = STATUS[s.status];
            return (
              <li key={s.id}>
                <Link href={`/teacher/scenarios/${s.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm hover:bg-arm-panel/60">
                  <span className="min-w-0 flex-1 basis-full sm:basis-0">
                    <span className="font-medium">{s.title}</span>
                    <span className="block text-xs text-arm-desc">
                      {s.category} · сложность {s.difficulty} · {s.place || "район не определён"} ·{" "}
                      {s.ticketRef ? `билет ${s.ticketRef}` : s.source === "generated" ? "сгенерирован ИИ" : "свой"} · изменён {formatDate(s.updatedAt)}
                    </span>
                  </span>
                  <span className="text-xs tabular-nums text-arm-desc">
                    разделов утверждено {s.approved} из {s.present}
                  </span>
                  <Badge tone={st.tone}>{st.label}</Badge>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>Сценариев с такими условиями нет.</Empty>
      )}
    </div>
  );
}
