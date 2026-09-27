import Link from "next/link";
import { Badge, Empty, PageHeader, Section, Stat } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/format";
import { LEARNING_CHECKS, verdictWord } from "@/lib/review/corrections";
import { listCorrections, type CorrectionListItem } from "@/lib/review/corrections-db";
import { CorrectionSwitch } from "./CorrectionSwitch";

const STATES = [
  { value: "", label: "Все" },
  { value: "active", label: "Действуют" },
  { value: "off", label: "Отключены" },
];
const ROLES = [
  { value: "", label: "Все места" },
  { value: "OP112", label: "112" },
  { value: "DDS", label: "ДДС" },
];

function Verdict({ ok }: { ok: boolean | null }) {
  const cls = ok == null ? "text-arm-desc" : ok ? "text-emerald-700" : "text-red-700";
  return (
    <b className={cls}>
      {ok == null ? "—" : ok ? "✓" : "✕"} {verdictWord(ok)}
    </b>
  );
}

function Status({ c }: { c: CorrectionListItem }) {
  if (c.active) return <Badge tone="green">действует</Badge>;
  if (c.offReason === "revised") return <Badge>заменена новым решением</Badge>;
  return <Badge tone="amber">отключена{c.offByName ? `: ${c.offByName}` : ""}</Badge>;
}

export default async function CorrectionsPage(props: PageProps<"/teacher/corrections">) {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const state = one(sp.state);
  const role = one(sp.role);
  const mine = one(sp.mine) === "1";
  const { items, stats, rules } = await listCorrections(user, { state, role, mine });
  const href = (patch: Record<string, string>) => {
    const q = new URLSearchParams({ state, role, mine: mine ? "1" : "", ...patch });
    for (const [k, v] of [...q.entries()]) if (!v) q.delete(k);
    const s = q.toString();
    return `/teacher/corrections${s ? `?${s}` : ""}`;
  };
  const tab = (on: boolean) => `rounded border px-3 py-1.5 text-sm ${on ? "border-arm-dark bg-arm-dark text-white" : "border-arm-gray bg-white hover:border-arm-blue"}`;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <PageHeader
        title="Учёт правок"
        subtitle="Когда вы исправляете проверку («ИИ неправ») с комментарием, правка сохраняется здесь. Проверки ИИ учитывают её в похожих случаях и решают так, как решил преподаватель."
      />

      <Section title="Как это работает">
        <ul className="list-disc space-y-1.5 pl-5 text-sm">
          <li>
            <b>Учатся только проверки ИИ:</b> {LEARNING_CHECKS.map((c) => `«${c.title.replace(/^ИИ: /, "")}»`).join(", ")}. Перед оценкой каждая читает до
            пяти действующих правок — сначала того же задания, потом того же типа происшествия, потом той же группы, свежие раньше. В разборе попытки видно:
            «учтены правки преподавателя: N».
          </li>
          <li>
            <b>Правила не учатся.</b> Правка по правилу (время, статусы, адрес…) действует только в своей попытке. Если у правила есть проверка ИИ того же
            смысла, правку прочитает она, а само правило не изменится.
          </li>
          <li>
            Правки — общая методика учебного центра: их видят и используют все преподаватели. Отключить правку может её автор или администратор —
            отключённая больше не попадает в проверки ИИ. Каждое изменение записано в журнал аудита.
          </li>
        </ul>
      </Section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Действующих правок" value={stats.active} />
        <Stat label="Из них читают проверки ИИ" value={stats.learning} />
        <Stat label="Учтены в проверках ИИ" value={stats.used} hint="сколько раз правки попали в оценку" />
        <Stat label="Отключены или заменены" value={stats.off} />
      </div>

      {rules.length > 0 && (
        <Section title="Правила, которые чаще всего исправляют">
          <ul className="flex flex-col gap-1 text-sm">
            {rules.map((r) => (
              <li key={r.code}>
                «{r.title}» — правок: <b className="tabular-nums">{r.count}</b>
                <span className="text-arm-desc"> · {r.learner ? `их читает «${r.learner}»` : "правило не учится — стоит пересмотреть правило или вес группы"}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <nav className="flex flex-wrap gap-1" aria-label="Состояние правки">
          {STATES.map((t) => (
            <Link key={t.value} href={href({ state: t.value })} className={tab(state === t.value)}>
              {t.label}
            </Link>
          ))}
        </nav>
        <nav className="flex flex-wrap gap-1" aria-label="Роль места">
          {ROLES.map((t) => (
            <Link key={t.value} href={href({ role: t.value })} className={tab(role === t.value)}>
              {t.label}
            </Link>
          ))}
        </nav>
        <Link href={href({ mine: mine ? "" : "1" })} className={tab(mine)} aria-pressed={mine}>
          Только мои
        </Link>
      </div>

      {items.length ? (
        <ul className="flex flex-col gap-3">
          {items.map((c) => (
            <li key={c.id} className={`rounded border bg-white p-4 text-sm ${c.active ? "border-arm-gray/70" : "border-dashed border-arm-gray opacity-80"}`}>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{c.title}</span>
                <Badge tone={c.source === "ai" ? "blue" : "neutral"}>{c.source === "ai" ? "оценивал ИИ" : "правило"}</Badge>
                <Badge tone={c.role === "OP112" ? "amber" : "blue"}>{c.role === "OP112" ? "112" : "ДДС"}</Badge>
                <span className="ml-auto">
                  <Status c={c} />
                </span>
              </div>
              <p className="mt-1 text-xs text-arm-desc">
                {c.learner ? (c.learner.self ? "Учит эту проверку ИИ" : `Правило не учится; правку читает «${c.learner.title}»`) : "Правило не учится: правка действует только в своей попытке"}
                {(c.typeName || c.scenarioTitle) && <> · {[c.typeName, c.scenarioTitle && `задание «${c.scenarioTitle}»`].filter(Boolean).join(" · ")}</>}
              </p>
              <div className="mt-2 grid gap-1 sm:grid-cols-[max-content_1fr] sm:gap-x-3">
                <span className="text-arm-desc">Черновик:</span>
                <span>
                  <Verdict ok={c.draftOk} />
                  {c.draftEvidence && <span className="text-arm-dark"> — {c.draftEvidence}</span>}
                </span>
                <span className="text-arm-desc">Решение:</span>
                <span>
                  <Verdict ok={c.teacherOk} /> — «{c.comment}»
                </span>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-arm-desc">
                <span>
                  {c.authorName}
                  {c.mine && " (вы)"}, {formatDateTime(c.createdAt)}
                </span>
                {c.learner && <span>учтена в проверках ИИ: {c.used}</span>}
                {c.attemptId && (
                  <Link href={`/teacher/attempts/${c.attemptId}`} className="text-arm-blue hover:underline">
                    Попытка →
                  </Link>
                )}
                {c.canSwitch && (
                  <span className="ml-auto">
                    <CorrectionSwitch id={c.id} active={c.active} />
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>
          {state || role || mine
            ? "Правок с такими условиями нет."
            : "Правок пока нет. Откройте попытку на проверке, нажмите «ИИ неправ — исправить», переключите проверку и напишите, как надо, — правка появится здесь."}
        </Empty>
      )}
    </div>
  );
}
