"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, inputClass } from "@/components/ui";
import type { TeacherFollowUp, TeacherStage } from "@/lib/followup/teacher";

type Stage = "practice" | "control";

const LESSON: Record<TeacherStage["lessonStatus"], string> = { DRAFT: "ждёт запуска", RUNNING: "идёт", FINISHED: "завершено" };

/** What a saved observation means: the practice never confirms the goal, only the control does. */
const OUTCOME: Record<string, string> = {
  practice_done: "Сохранено: на отработке ученик выполнил действие с подсказками. Цель подтвердит только контроль на новой ситуации.",
  practice_not_done: "Сохранено: на отработке действие не выполнено. Разберите ошибку с учеником до контроля.",
  practice_insufficient: "Сохранено. Проверки цели в попытке отработки неполные; цель подтвердит только контроль.",
  achieved: "Сохранено: цель выполнена на новой ситуации без подсказок.",
  failed: "Сохранено: на контроле цель не выполнена.",
  insufficient: "Сохранено, но нужные проверки цели на контроле не сработали — данных для вывода недостаточно.",
};

const TONE: Record<string, "green" | "red" | "amber" | "blue" | "neutral"> = {
  achieved: "green", not_achieved: "red", insufficient: "amber", practice_missed: "amber", control_missed: "amber",
  review_practice: "blue", review_control: "blue", observe_control: "blue", cancelled: "neutral", source_changed: "amber",
};

async function patch(id: string, body: unknown): Promise<{ ok: boolean; data: { error?: string; outcome?: string } }> {
  const response = await fetch(`/api/teacher/followups/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { ok: response.ok, data: await response.json().catch(() => ({})) as { error?: string; outcome?: string } };
}

function ObservationForm({ id, stage, attemptId, onDone }: { id: string; stage: Stage; attemptId: string; onDone: (text: string) => void }) {
  const [observed, setObserved] = useState<"" | "yes" | "no">("");
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setBusy(true); setError(null);
    try {
      const { ok, data } = await patch(id, { action: "observe", stage, attemptId, observed: observed === "yes", evidence: evidence.trim() });
      if (!ok) { setError(data.error ?? "Не удалось сохранить"); return; }
      setObserved(""); setEvidence("");
      onDone(OUTCOME[data.outcome ?? ""] ?? "Наблюдение сохранено");
    } catch { setError("Нет связи с сервером"); }
    finally { setBusy(false); }
  }
  return <div className="mt-2 grid gap-2 border-t border-arm-gray/50 pt-2">
    <label className="grid gap-1 text-sm">Что ученик сделал в этой попытке
      <select className={inputClass} value={observed} onChange={(event) => setObserved(event.target.value as typeof observed)}>
        <option value="">Выберите после просмотра разговора и карточки</option>
        <option value="yes">{stage === "practice" ? "Выполнил (с подсказками)" : "Выполнил"}</option>
        <option value="no">Не выполнил</option>
      </select>
    </label>
    <label className="grid gap-1 text-sm">Основание — какая реплика или запись это показывает
      <textarea className="min-h-16 rounded border border-arm-gray p-2 text-sm" maxLength={1000} value={evidence} onChange={(event) => setEvidence(event.target.value)}
        placeholder={stage === "practice" ? "Например: спросил номер дома после подсказки и записал ответ заявителя" : "Например: сам спросил номер дома и корпус, записал то, что подтвердил заявитель"} />
    </label>
    <div><Button size="sm" disabled={busy || !observed || evidence.trim().length < 12} onClick={save}>{busy ? "Сохраняем…" : "Сохранить наблюдение"}</Button></div>
    {stage === "practice" && <p className="text-xs text-arm-desc">Наблюдение по отработке не подтверждает навык: цель засчитывается только по контролю на новой ситуации без подсказок.</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}

function StageCard({ id, stage, data, onDone }: { id: string; stage: Stage; data: TeacherStage; onDone: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const observable = data.lessonStatus === "FINISHED" && data.checked && !!data.attemptId;
  const o = data.observation;
  return <li className="rounded border border-arm-gray/70 p-3 text-sm">
    <b>{stage === "practice" ? "Отработка" : "Контроль"}</b> · {stage === "practice" ? "с подсказками" : "без подсказок"} · {LESSON[data.lessonStatus]}
    {data.scenarioTitle && <span className="block text-arm-desc">Ситуация: «{data.scenarioTitle}»</span>}
    <div className="mt-1 flex flex-wrap gap-3">
      <Link className="text-arm-blue underline" href={`/teacher/lessons/${data.lessonId}`}>Открыть занятие</Link>
      {data.attemptId && <Link className="text-arm-blue underline" href={`/teacher/attempts/${data.attemptId}`}>{data.checked ? "Проверенная попытка" : "Проверить попытку"}</Link>}
      {data.lessonStatus === "FINISHED" && !data.attemptId && <span className="text-amber-800">Попытки ученика нет</span>}
    </div>
    {o && <div className={`mt-2 rounded p-2 ${o.current ? "bg-arm-panel" : "bg-amber-50"}`}>
      <p><b>Наблюдение: {o.observed ? (stage === "practice" ? "выполнил с подсказками" : "выполнил") : "не выполнил"}</b></p>
      <p className="mt-0.5">Основание: «{o.evidence}»</p>
      <p className="mt-0.5 text-xs text-arm-desc">{o.by}, {o.at}{o.current ? "" : " · относится к прежней проверке попытки — отметьте заново"}</p>
    </div>}
    {observable && (!o || !o.current || editing
      ? <ObservationForm id={id} stage={stage} attemptId={data.attemptId!} onDone={(text) => { setEditing(false); onDone(text); }} />
      : <Button size="sm" variant="ghost" className="mt-1" onClick={() => setEditing(true)}>Изменить наблюдение</Button>)}
    {!observable && data.lessonStatus === "FINISHED" && data.attemptId && !data.checked && <p className="mt-1 text-xs text-arm-desc">Наблюдение можно отметить после проверки попытки.</p>}
  </li>;
}

/** The teacher runs the route: sees both stages, repeats a missed one, records what the student did, keeps the history. */
export function FollowUpProgress({ item }: { item: TeacherFollowUp }) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [controlId, setControlId] = useState(item.controlChoices?.[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = (text: string) => { setMessage(text); router.refresh(); };

  async function act(body: unknown, text: string) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const { ok, data } = await patch(item.id, body);
      if (!ok) { setError(data.error ?? "Не удалось сохранить"); return; }
      setReason(""); setShowCancel(false);
      done(text);
    } catch { setError("Нет связи с сервером"); }
    finally { setBusy(false); }
  }

  const choices = item.controlChoices ?? [];
  const chosen = choices.find((c) => c.id === controlId) ?? choices[0] ?? null;
  return <section id="followup" className="rounded border border-arm-gray/70 bg-white p-4 print:hidden" aria-label="Назначенная отработка">
    <h2 className="font-semibold">Назначенная отработка</h2>
    <p className="mt-1 flex flex-wrap items-center gap-2 text-sm"><b>{item.title}</b><Badge tone={TONE[item.state] ?? "neutral"}>{item.status}</Badge></p>
    {item.target && <p className="mt-1 text-sm">По замечанию: <b>{item.target.title}</b>{item.target.evidence ? <span className="text-arm-desc"> — {item.target.evidence}</span> : null}</p>}
    {item.next && <p className="mt-2 rounded bg-arm-panel p-2 text-sm"><b>Дальше:</b> {item.next}</p>}
    {item.controlSeen && <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">Ученик уже встретил контрольную ситуацию после назначения — замените её, иначе контроль не начнётся.</p>}
    <ul className="mt-3 grid gap-2 md:grid-cols-2">
      <StageCard id={item.id} stage="practice" data={item.practice} onDone={done} />
      <StageCard id={item.id} stage="control" data={item.control} onDone={done} />
    </ul>
    {!item.cancelled && item.state === "practice_missed" && <div className="mt-3">
      <Button variant="primary" disabled={busy} onClick={() => act({ action: "repeat", stage: "practice" }, "Отработка назначена повторно: создано новое занятие — начните его, когда ученик будет на месте.")}>Повторить отработку</Button>
      <p className="mt-1 text-xs text-arm-desc">Новое занятие с тем же заданием для этого ученика; завершённое остаётся в истории. Если в контроле есть другие ученики, этот ученик пройдёт контроль отдельным занятием.</p>
    </div>}
    {!item.cancelled && (item.state === "control_missed" || item.controlSeen) && <div className="mt-3 grid gap-2">
      {choices.length ? <>
        <label className="grid gap-1 text-sm">{item.state === "control_missed" ? "Ситуация для повторного контроля" : "Новая ситуация для контроля"}
          <select className={inputClass} value={chosen?.id ?? ""} onChange={(event) => setControlId(event.target.value)}>
            {choices.map((c) => <option key={c.id} value={c.id}>{c.title} · сложность {c.difficulty}{c.marked ? " · подобрана методистом" : ""}</option>)}
          </select>
        </label>
        <div>
          <Button variant="primary" disabled={busy || !chosen} onClick={() => chosen && act(item.state === "control_missed"
            ? { action: "repeat", stage: "control", controlScenarioId: chosen.id }
            : { action: "replace_control", controlScenarioId: chosen.id }, item.state === "control_missed" ? "Контроль назначен повторно: создано новое занятие." : "Контрольная ситуация заменена.")}>
            {item.state === "control_missed" ? "Повторить контроль" : "Заменить контроль"}
          </Button>
        </div>
      </> : <p className="text-sm text-amber-800">Новой для ученика контрольной ситуации нет: утвердите ещё один подходящий сценарий в <Link className="underline" href="/teacher/scenarios">«Сценариях»</Link> или отмените назначение.</p>}
    </div>}
    {item.history.length > 0 && <details className="mt-3 text-sm" open={item.history.length > 1}>
      <summary className="cursor-pointer font-medium">История назначения ({item.history.length})</summary>
      <ol className="mt-2 grid gap-1.5">
        {item.history.map((h, i) => <li key={i} className="border-l-2 border-arm-gray/70 pl-2">
          <span className="text-xs text-arm-desc">{h.at}{h.who ? ` · ${h.who}` : ""}</span>
          <span className="block">{h.text}{h.lessonId ? <> · <Link className="text-arm-blue underline" href={`/teacher/lessons/${h.lessonId}`}>занятие</Link></> : null}</span>
          {h.evidence && <span className="block text-arm-desc">Основание: «{h.evidence}»</span>}
        </li>)}
      </ol>
    </details>}
    {!item.cancelled && <div className="mt-3 text-sm">
      {!showCancel ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => setShowCancel(true)}>Отменить назначение</Button> : <div className="grid gap-2">
        <label className="grid gap-1">Причина отмены
          <textarea className="min-h-16 rounded border border-arm-gray p-2" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-2"><Button variant="danger" disabled={busy || reason.trim().length < 5} onClick={() => act({ action: "cancel", reason: reason.trim() }, "Назначение отменено")}>Отменить с записью причины</Button>
          <Button disabled={busy} onClick={() => setShowCancel(false)}>Оставить назначение</Button></div>
      </div>}
    </div>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mt-2 text-sm text-emerald-800">{message}</p>}
  </section>;
}
