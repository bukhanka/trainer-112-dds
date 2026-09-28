"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { Button, inputClass } from "@/components/ui";
import type { LearningMeta } from "@/lib/followup/metadata";

type Skill = "op112.location" | "dds.report_record";
export type Candidate = { attemptId: string; name: string; role: "OP112" | "DDS"; service: string | null; skills: Skill[] };
export type CaseChoice = { id: string; title: string; difficulty: number; meta: LearningMeta };
const label: Record<Skill, string> = {
  "op112.location": "Уточнить и записать место происшествия",
  "dds.report_record": "Отразить доклад бригады в статусе и записи",
};

/** The teacher approves the target and both cases. No scenario content is sent to the student's assignment list. */
export function AssignFollowUp({ candidates, scenarios, compact = false }: { candidates: Candidate[]; scenarios: CaseChoice[]; compact?: boolean }) {
  const router = useRouter();
  const allowed = (["op112.location", "dds.report_record"] as Skill[]).filter((key) => candidates.some((c) => c.skills.includes(key)));
  const [skill, setSkill] = useState<Skill>(allowed[0] ?? "op112.location");
  const [chosen, setChosen] = useState<string[]>(compact && candidates[0] ? [candidates[0].attemptId] : []);
  const [practiceId, setPracticeId] = useState("");
  const [controlId, setControlId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ practiceLessonId: string; controlLessonId: string } | null>(null);

  const role = skill === "op112.location" ? "OP112" : "DDS";
  const relevant = candidates.filter((c) => c.skills.includes(skill) && c.role === role);
  const practices = scenarios.filter((s) => s.meta.purpose === "practice" && s.meta.role === role && s.meta.skillKeys.includes(skill));
  const selectedPractice = practices.find((s) => s.id === practiceId);
  const controls = scenarios.filter((s) => s.meta.purpose === "control" && s.meta.role === role && s.meta.skillKeys.includes(skill)
    && (!selectedPractice || s.meta.equivalenceKey === selectedPractice.meta.equivalenceKey) && s.meta.caseKey !== selectedPractice?.meta.caseKey);
  const selected = useMemo(() => candidates.filter((c) => chosen.includes(c.attemptId) && c.skills.includes(skill)), [candidates, chosen, skill]);
  if (!allowed.length) return null;

  async function assign() {
    if (!selected.length || !practiceId || !controlId) return;
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/teacher/followups", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillKey: skill, items: selected.map((c) => ({ attemptId: c.attemptId, practiceScenarioId: practiceId, controlScenarioId: controlId })) }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; practiceLessonId?: string; controlLessonId?: string };
      if (!res.ok || !body.practiceLessonId || !body.controlLessonId) { setError(body.error ?? "Не удалось назначить"); return; }
      setCreated({ practiceLessonId: body.practiceLessonId, controlLessonId: body.controlLessonId });
      router.refresh();
    } catch { setError("Нет связи с сервером"); }
    finally { setBusy(false); }
  }

  return <section className="rounded border border-arm-gray/70 bg-white p-4 print:hidden">
    <h2 className="font-semibold">Отработка ошибки</h2>
    <p className="mt-1 text-sm text-arm-desc">Выберите проверенную ошибку и два разных случая одинаковой сложности. Занятия запускает преподаватель.</p>
    <div className="mt-3 grid gap-3 md:grid-cols-3">
      <label className="flex flex-col gap-1 text-sm">Навык
        <select className={inputClass} value={skill} onChange={(e) => { setSkill(e.target.value as Skill); setChosen([]); setPracticeId(""); setControlId(""); }}>
          {allowed.map((key) => <option key={key} value={key}>{label[key]}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">Ситуация для отработки
        <select className={inputClass} value={practiceId} onChange={(e) => { setPracticeId(e.target.value); setControlId(""); }}>
          <option value="">Выберите утверждённый сценарий</option>
          {practices.map((s) => <option key={s.id} value={s.id}>{s.title} · сложность {s.difficulty}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm">Новая ситуация для контроля
        <select className={inputClass} value={controlId} onChange={(e) => setControlId(e.target.value)}>
          <option value="">Выберите сопоставимый сценарий</option>
          {controls.map((s) => <option key={s.id} value={s.id}>{s.title} · сложность {s.difficulty}</option>)}
        </select>
      </label>
    </div>
    <fieldset className="mt-3">
      <legend className="text-sm font-medium">Кому назначить</legend>
      <div className="mt-1 grid gap-1 sm:grid-cols-2">
        {relevant.map((c) => <label key={c.attemptId} className="flex min-h-10 items-center gap-2 rounded border border-arm-gray/60 px-2 text-sm">
          <input type="checkbox" checked={chosen.includes(c.attemptId)} onChange={() => setChosen((list) => list.includes(c.attemptId) ? list.filter((id) => id !== c.attemptId) : [...list, c.attemptId])} />
          <span>{c.name}{c.service ? ` · ${c.service}` : ""}</span>
        </label>)}
      </div>
    </fieldset>
    {!practices.length && <p className="mt-2 text-sm text-amber-800">Для навыка пока нет подготовленного сценария отработки. Утвердите его в «Сценариях».</p>}
    {practiceId && !controls.length && <p className="mt-2 text-sm text-amber-800">Нет нового сопоставимого контрольного сценария.</p>}
    <Button className="mt-3" variant="primary" disabled={busy || !selected.length || !practiceId || !controlId} onClick={assign}>
      {busy ? "Назначаем…" : `Назначить ${selected.length} ${selected.length === 1 ? "ученику" : "ученикам"}`}
    </Button>
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {created && <p className="mt-2 text-sm text-emerald-800">Созданы занятия: <Link className="underline" href={`/teacher/lessons/${created.practiceLessonId}`}>отработка</Link> и <Link className="underline" href={`/teacher/lessons/${created.controlLessonId}`}>контроль</Link>.</p>}
  </section>;
}

