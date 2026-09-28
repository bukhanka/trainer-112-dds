"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";

type Stage = { lessonId: string; lessonStatus: string; attemptId: string | null; checked: boolean };
export type TeacherFollowUp = {
  id: string; title: string; state: string; status: string;
  practice: Stage; control: Stage;
  cancelled: boolean;
};

function StageRow({ label, stage, hints }: { label: string; stage: Stage; hints: boolean }) {
  return <li className="rounded border border-arm-gray/70 p-3 text-sm">
    <b>{label}</b> · {hints ? "с подсказками" : "без подсказок"} · {stage.lessonStatus === "DRAFT" ? "ждёт запуска" : stage.lessonStatus === "RUNNING" ? "идёт" : "завершено"}
    <div className="mt-1 flex flex-wrap gap-3">
      <Link className="text-arm-blue underline" href={`/teacher/lessons/${stage.lessonId}`}>Открыть занятие</Link>
      {stage.attemptId && <Link className="text-arm-blue underline" href={`/teacher/attempts/${stage.attemptId}`}>{stage.checked ? "Проверенная попытка" : "Проверить попытку"}</Link>}
      {stage.lessonStatus === "FINISHED" && !stage.attemptId && <span className="text-amber-800">Нет выполненной попытки</span>}
    </div>
  </li>;
}

/** The teacher closes the loop by citing what happened in the actual later attempt. */
export function FollowUpProgress({ item }: { item: TeacherFollowUp }) {
  const router = useRouter();
  const [stage, setStage] = useState<"practice" | "control">("control");
  const [observed, setObserved] = useState<"" | "yes" | "no">("");
  const [evidence, setEvidence] = useState("");
  const [reason, setReason] = useState("");
  const [showCancel, setShowCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const chosen = stage === "practice" ? item.practice : item.control;
  const canObserve = chosen.lessonStatus === "FINISHED" && chosen.checked && !!chosen.attemptId;

  async function write(body: unknown) {
    setBusy(true); setError(null); setMessage(null);
    try {
      const response = await fetch(`/api/teacher/followups/${item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json().catch(() => ({})) as { error?: string; outcome?: string };
      if (!response.ok) { setError(data.error ?? "Не удалось сохранить"); return; }
      setMessage(data.outcome === "achieved" ? "Навык подтверждён на новой ситуации" : data.outcome === "insufficient" ? "Недостаточно данных: проверьте критерии и свидетельство" : body && typeof body === "object" && "action" in body && body.action === "cancel" ? "Назначение отменено" : "Наблюдение сохранено");
      setObserved(""); setEvidence(""); setReason(""); setShowCancel(false);
      router.refresh();
    } catch { setError("Нет связи с сервером"); }
    finally { setBusy(false); }
  }

  return <section className="rounded border border-arm-gray/70 bg-white p-4 print:hidden">
    <h2 className="font-semibold">Назначенная отработка</h2>
    <p className="mt-1 text-sm"><b>{item.title}</b> · {item.status}</p>
    <ul className="mt-3 grid gap-2 md:grid-cols-2">
      <StageRow label="Отработка" stage={item.practice} hints />
      <StageRow label="Контроль" stage={item.control} hints={false} />
    </ul>
    {!item.cancelled && <div className="mt-3 border-t border-arm-gray/50 pt-3">
      <h3 className="text-sm font-semibold">Что ученик сделал в новой попытке?</h3>
      <p className="mt-1 text-xs text-arm-desc">Запись адреса или статуса сама по себе не доказывает, что ученик уточнил место или действовал по докладу. Сверьте разговор и карточку.</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">Этап
          <select className="rounded border border-arm-gray p-2" value={stage} onChange={(event) => { setStage(event.target.value as typeof stage); setObserved(""); }}>
            <option value="practice">Отработка</option><option value="control">Контроль</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">Наблюдаемое действие
          <select className="rounded border border-arm-gray p-2" value={observed} onChange={(event) => setObserved(event.target.value as typeof observed)}>
            <option value="">Выберите после просмотра попытки</option><option value="yes">Выполнил</option><option value="no">Не выполнил</option>
          </select>
        </label>
      </div>
      <label className="mt-2 grid gap-1 text-sm">Основание — какая реплика или запись это показывает
        <textarea className="min-h-16 rounded border border-arm-gray p-2" maxLength={1000} value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="Например: уточнил номер дома в разговоре, затем записал его в карточку" />
      </label>
      <Button className="mt-2" disabled={busy || !canObserve || !observed || evidence.trim().length < 12}
        onClick={() => write({ action: "observe", stage, attemptId: chosen.attemptId, observed: observed === "yes", evidence: evidence.trim() })}>Сохранить наблюдение</Button>
      {!canObserve && <p className="mt-1 text-xs text-arm-desc">Сначала закончите этап и проверьте попытку преподавателем.</p>}
      <div className="mt-3 text-sm">
        {!showCancel ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => setShowCancel(true)}>Отменить назначение</Button> : <div className="grid gap-2">
          <label className="grid gap-1">Причина отмены
            <textarea className="min-h-16 rounded border border-arm-gray p-2" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="flex gap-2"><Button variant="danger" disabled={busy || reason.trim().length < 5} onClick={() => write({ action: "cancel", reason: reason.trim() })}>Отменить с записью причины</Button>
            <Button disabled={busy} onClick={() => setShowCancel(false)}>Оставить назначение</Button></div>
        </div>}
      </div>
    </div>}
    {error && <p role="alert" className="mt-2 text-sm text-red-700">{error}</p>}
    {message && <p role="status" className="mt-2 text-sm text-emerald-800">{message}</p>}
  </section>;
}
