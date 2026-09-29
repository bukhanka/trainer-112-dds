"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, inputClass } from "@/components/ui";
import { commonOptions, pairProblem, type Candidate, type CaseOption, type Skill } from "@/lib/followup/pairing";

const LABEL: Record<Skill, string> = {
  "op112.location": "Уточнить и записать место происшествия",
  "dds.report_record": "Отразить доклад бригады в статусе и записи",
};
const ROLE: Record<Skill, "OP112" | "DDS"> = { "op112.location": "OP112", "dds.report_record": "DDS" };

const short = (name: string) => {
  const [last, ...rest] = name.trim().split(/\s+/);
  return rest.length ? `${last} ${rest.map((p) => `${p[0]}.`).join(" ")}` : last;
};

function optionText(o: CaseOption, purpose: "practice" | "control"): string {
  return [o.title, `сложность ${o.difficulty}`, o.marked ? "подобрана методистом" : "", purpose === "practice" && o.seen ? "уже встречалась" : ""].filter(Boolean).join(" · ");
}

type Created = { practiceLessonId: string; controlLessonId: string; count: number; names: string[] };

/**
 * The teacher approves the goal and both cases. The cases offered suit every chosen student: the place's role, service
 * and territory, not the situation of the error, a control new to the student (lib/followup/pool.ts). No scenario
 * content goes to the student's assignment list.
 */
export function AssignFollowUp({ candidates, compact = false }: { candidates: Candidate[]; compact?: boolean }) {
  const router = useRouter();
  const allowed = (["op112.location", "dds.report_record"] as Skill[]).filter((key) => candidates.some((c) => c.skills.includes(key)));
  const [skill, setSkill] = useState<Skill>(allowed[0] ?? "op112.location");
  const [chosen, setChosen] = useState<string[]>(compact && candidates[0] ? [candidates[0].attemptId] : []);
  const [practiceId, setPracticeId] = useState("");
  const [controlId, setControlId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  const role = ROLE[skill];
  const relevant = candidates.filter((c) => c.skills.includes(skill) && c.role === role);
  const ready = relevant.filter((c) => !c.pool.problem);
  const selected = ready.filter((c) => chosen.includes(c.attemptId));
  // Before anyone is ticked the lists show what suits every student who can get the goal; ticking fewer only adds cases.
  const basis = selected.length ? selected : ready;
  const practices = commonOptions(basis.map((c) => c.pool.practice));
  const practice = practices.find((o) => o.id === practiceId) ?? null;
  const controls = practice ? commonOptions(basis.map((c) => c.pool.control)).filter((o) => pairProblem(role, practice, o) === null) : [];
  const control = controls.find((o) => o.id === controlId) ?? null;
  const blocked = relevant.filter((c) => c.pool.problem);

  if (!allowed.length && !created) return null;

  async function assign() {
    if (!selected.length || !practice || !control) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/teacher/followups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillKey: skill, items: selected.map((c) => ({ attemptId: c.attemptId, practiceScenarioId: practice.id, controlScenarioId: control.id })) }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; practiceLessonId?: string; controlLessonId?: string };
      if (!res.ok || !body.practiceLessonId || !body.controlLessonId) { setError(body.error ?? "Не удалось назначить"); return; }
      setCreated({ practiceLessonId: body.practiceLessonId, controlLessonId: body.controlLessonId, count: selected.length, names: selected.map((c) => short(c.name)) });
      setChosen([]); setPracticeId(""); setControlId("");
      router.refresh();
    } catch { setError("Нет связи с сервером"); }
    finally { setBusy(false); }
  }

  return <section className="rounded border border-arm-gray/70 bg-white p-4 print:hidden" aria-label="Отработка ошибки">
    <h2 className="font-semibold">Отработка ошибки</h2>
    {created && <div role="status" className="mt-2 rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
      <p className="font-medium">Назначено: {created.names.join(", ")}.</p>
      <p className="mt-1">Созданы черновики двух занятий:{" "}
        <Link className="font-medium underline" href={`/teacher/lessons/${created.practiceLessonId}`}>«Отработка» — с подсказками</Link> и{" "}
        <Link className="font-medium underline" href={`/teacher/lessons/${created.controlLessonId}`}>«Контроль» — новая ситуация без подсказок</Link>.
      </p>
      <p className="mt-1 text-emerald-800">Дальше: начните отработку на странице занятия. Контроль можно начать, когда попытки отработки проверены.</p>
    </div>}
    {allowed.length > 0 && <>
      <p className="mt-1 text-sm text-arm-desc">
        Выберите проверенную ошибку и две разные ситуации: для отработки с подсказками и новую для контроля. В списках — только то, что подходит
        {compact ? " ученику" : " всем выбранным ученикам"}: роль и служба места, её территория, не исходная ситуация; контроль — ещё не знакомый ученику.
      </p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">Навык
          <select className={inputClass} value={skill} onChange={(e) => { setSkill(e.target.value as Skill); setChosen([]); setPracticeId(""); setControlId(""); }}>
            {allowed.map((key) => <option key={key} value={key}>{LABEL[key]}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">Ситуация для отработки
          <select className={inputClass} value={practice ? practice.id : ""} disabled={!practices.length} onChange={(e) => { setPracticeId(e.target.value); setControlId(""); }}>
            <option value="">{practices.length ? `Выберите из ${practices.length}` : "Нет подходящей ситуации"}</option>
            {practices.map((o) => <option key={o.id} value={o.id}>{optionText(o, "practice")}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">Новая ситуация для контроля
          <select className={inputClass} value={control ? control.id : ""} disabled={!practice || !controls.length} onChange={(e) => setControlId(e.target.value)}>
            <option value="">{!practice ? "Сначала выберите отработку" : controls.length ? `Выберите из ${controls.length}` : "Нет подходящей ситуации"}</option>
            {controls.map((o) => <option key={o.id} value={o.id}>{optionText(o, "control")}</option>)}
          </select>
        </label>
      </div>
      {!compact && <fieldset className="mt-3">
        <legend className="text-sm font-medium">Кому назначить</legend>
        <div className="mt-1 grid gap-1 sm:grid-cols-2">
          {ready.map((c) => <label key={c.attemptId} className="flex min-h-10 items-center gap-2 rounded border border-arm-gray/60 px-2 py-1 text-sm">
            <input type="checkbox" checked={chosen.includes(c.attemptId)} onChange={() => setChosen((list) => list.includes(c.attemptId) ? list.filter((id) => id !== c.attemptId) : [...list, c.attemptId])} />
            <span>{c.name}{c.service ? ` · ${c.service}` : ""}{c.source ? <span className="block text-xs text-arm-desc">ошибка в «{c.source}»</span> : null}</span>
          </label>)}
        </div>
      </fieldset>}
      {compact && ready[0] && <p className="mt-2 text-sm">Кому: <b>{ready[0].name}</b>{ready[0].service ? ` · ${ready[0].service}` : ""}{ready[0].source ? ` · ошибка в «${ready[0].source}»` : ""}</p>}
      {blocked.length > 0 && <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
        {blocked.map((c) => <p key={c.attemptId} className="mt-1 first:mt-0">{compact ? "" : <b>{short(c.name)}{c.service ? ` (${c.service})` : ""}: </b>}{c.pool.problem}</p>)}
        <p className="mt-2"><Link className="underline" href="/teacher/scenarios">Открыть «Сценарии»</Link></p>
      </div>}
      {ready.length > 0 && !practices.length && <p className="mt-2 text-sm text-amber-800">
        Для {selected.length ? "выбранных учеников" : "всех учеников сразу"} нет общей ситуации: у них разные службы или исходные задания. Отметьте учеников одной службы с похожей ошибкой или назначьте отработку по отдельности из разбора их попыток.
      </p>}
      {practice && !controls.length && <p className="mt-2 text-sm text-amber-800">Для этой отработки нет нового для {selected.length > 1 ? "всех выбранных" : "ученика"} контроля сопоставимой сложности. Выберите другую ситуацию отработки.</p>}
      {ready.length > 0 && <Button className="mt-3" variant="primary" disabled={busy || !selected.length || !practice || !control} onClick={assign}>
        {busy ? "Назначаем…" : `Назначить ${selected.length} ${selected.length === 1 ? "ученику" : "ученикам"}`}
      </Button>}
      {!compact && ready.length > 0 && !selected.length && <p className="mt-1 text-xs text-arm-desc">Отметьте учеников, которым нужна эта отработка.</p>}
    </>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
  </section>;
}
