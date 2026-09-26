"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { shortName } from "@/lib/format";
import { computeScore, WEIGHT_GROUPS, type CriterionResult, type Overrides, type WeightGroup, type Weights } from "@/lib/scoring/score";
import { DEFAULT_WEIGHTS, GROUP_KEYS, WEIGHT_MAX } from "@/lib/scoring/weight-config";

export type PreviewAttempt = {
  id: string;
  kind: "OP112" | "DDS";
  reviewed: boolean;
  lessonId: string;
  lessonTitle: string;
  studentId: string;
  student: string;
  criteria: CriterionResult[];
  override: Overrides | null;
};

const HINTS: Record<WeightGroup, string> = {
  timeliness: "ответ ДДС за 30 с, наряд за 3 мин, набор карточки 112",
  statusOrder: "статусы по порядку, доклады бригады, закрытие карточки",
  comments: "комментарий к «Не принята» и «Отказ»: причина и кому передано",
  address: "улица и дом; похожая улица — критичная ошибка",
  services: "тип происшествия, службы, решение принять или отказать",
  completeness: "заявитель, пострадавшие, обязательные вопросы, «сказал ↔ заполнил»",
  literacy: "текст понятен следующему диспетчеру",
};

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const delta = (a: number | null, b: number | null) => (a == null || b == null ? null : b - a);
const sign = (d: number | null) => (d == null ? "" : d > 0 ? `+${d}` : d < 0 ? `−${Math.abs(d)}` : "0");
const same = (a: Weights, b: Weights) => GROUP_KEYS.every((k) => a[k] === b[k]);

export function WeightsPanel({ saved, savedName, attempts, runningLesson }: { saved: Weights; savedName: string | null; attempts: PreviewAttempt[]; runningLesson: string | null }) {
  const router = useRouter();
  const [weights, setWeights] = useState<Weights>(saved);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const rows = attempts.map((a) => ({
    ...a,
    before: computeScore(a.criteria, saved, a.override),
    after: computeScore(a.criteria, weights, a.override),
  }));
  const counted = rows.filter((r) => r.reviewed);
  const changed = rows.filter((r) => r.before !== r.after);
  const avgBefore = avg(counted.flatMap((r) => (r.before == null ? [] : [r.before])));
  const avgAfter = avg(counted.flatMap((r) => (r.after == null ? [] : [r.after])));
  const ready = (key: "before" | "after") => counted.filter((r) => (r[key] ?? 0) >= 70).length;

  const byStudent = [...new Map(counted.map((r) => [r.studentId, r.student])).entries()]
    .map(([id, name]) => {
      const mine = counted.filter((r) => r.studentId === id);
      return {
        id,
        name,
        before: avg(mine.flatMap((r) => (r.before == null ? [] : [r.before]))),
        after: avg(mine.flatMap((r) => (r.after == null ? [] : [r.after]))),
        n: mine.length,
      };
    })
    .sort((a, b) => (b.after ?? -1) - (a.after ?? -1));
  const byLesson = [...new Map(counted.map((r) => [r.lessonId, r.lessonTitle])).entries()].map(([id, title]) => {
    const mine = counted.filter((r) => r.lessonId === id);
    return { id, title, before: avg(mine.flatMap((r) => (r.before == null ? [] : [r.before]))), after: avg(mine.flatMap((r) => (r.after == null ? [] : [r.after]))), n: mine.length };
  });
  const biggest = [...changed].sort((a, b) => Math.abs((b.after ?? 0) - (b.before ?? 0)) - Math.abs((a.after ?? 0) - (a.before ?? 0))).slice(0, 8);
  const dirty = !same(weights, saved);

  async function save() {
    if (!window.confirm(`Сохранить веса? Баллы пересчитаются у всех попыток (${attempts.length} у вас; веса общие для центра).`)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/teacher/weights", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weights }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string; total?: number; changed?: number };
      if (!res.ok) setMessage({ ok: false, text: data.error ?? "Не удалось сохранить" });
      else {
        setMessage({ ok: true, text: `Сохранено. Пересчитано попыток: ${data.changed} из ${data.total}.` });
        router.refresh();
      }
    } catch {
      setMessage({ ok: false, text: "Нет связи с сервером" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section className="rounded border border-arm-gray/70 bg-white p-4 lg:col-start-1 lg:row-start-1">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold">Семь групп проверок</h2>
          <span className="text-xs text-arm-desc">0 — не учитывать, {WEIGHT_MAX} — важнее всего</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" onClick={() => setWeights(DEFAULT_WEIGHTS)} disabled={same(weights, DEFAULT_WEIGHTS)}>
              По умолчанию
            </Button>
            <Button size="sm" onClick={() => setWeights(saved)} disabled={!dirty}>
              Как сохранено
            </Button>
          </div>
        </div>
        <ul className="flex flex-col gap-4">
          {GROUP_KEYS.map((g) => (
            <li key={g} className="grid gap-1 sm:grid-cols-[minmax(0,1fr)_14rem] sm:items-center sm:gap-4">
              <label htmlFor={`w-${g}`} className="text-sm">
                <span className="font-medium">{WEIGHT_GROUPS[g]}</span>
                <span className="block text-xs text-arm-desc">{HINTS[g]}</span>
              </label>
              <div className="flex items-center gap-3">
                <input
                  id={`w-${g}`}
                  type="range"
                  min={0}
                  max={WEIGHT_MAX}
                  step={0.5}
                  value={weights[g]}
                  onChange={(e) => setWeights((w) => ({ ...w, [g]: Number(e.target.value) }))}
                  className="h-2 w-full cursor-pointer accent-arm-blue"
                />
                <span className={`w-10 text-right font-mono text-lg font-semibold tabular-nums ${weights[g] !== saved[g] ? "text-arm-blue" : ""}`}>{weights[g]}</span>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-arm-desc">
          Балл попытки — доля пройденных проверок в каждой группе, взвешенная по этим весам. «Не применимо» не считается. Критичная ошибка (например, похожая улица)
          ограничивает балл 40 из 100.
        </p>
      </section>

      <aside className="order-first flex flex-col gap-3 lg:sticky lg:top-4 lg:order-none lg:col-start-2 lg:row-start-1 lg:self-start">
        <section className="rounded border border-arm-gray/70 bg-white p-4">
          <div className="text-sm text-arm-desc">Средний балл подтверждённых попыток</div>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-semibold tabular-nums text-arm-desc">{avgBefore ?? "—"}</span>
            <span className="text-arm-desc">→</span>
            <span className="text-4xl font-bold tabular-nums">{avgAfter ?? "—"}</span>
            <span className={`text-sm font-semibold ${(delta(avgBefore, avgAfter) ?? 0) < 0 ? "text-red-700" : "text-emerald-700"}`}>{sign(delta(avgBefore, avgAfter))}</span>
          </div>
          <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5 text-sm">
            <dt className="text-arm-desc">Попыток изменили балл</dt>
            <dd className="tabular-nums">
              {changed.length} из {rows.length}
            </dd>
            <dt className="text-arm-desc">Набрали 70 и больше</dt>
            <dd className="tabular-nums">
              {ready("before")} → {ready("after")} из {counted.length}
            </dd>
          </dl>
          {savedName && <p className="mt-2 text-xs text-arm-desc">Сохранено: {savedName}</p>}
        </section>
        {runningLesson && (
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Идёт занятие «{runningLesson}». Сохранить веса можно после его окончания, предпросмотр работает.
          </p>
        )}
        <Button variant="primary" disabled={busy || !dirty || Boolean(runningLesson)} onClick={save}>
          {busy ? "Сохраняю…" : "Сохранить и пересчитать"}
        </Button>
        {message && (
          <p role="status" className={`rounded border p-2 text-sm ${message.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-800"}`}>
            {message.text}
          </p>
        )}
      </aside>

      <section className="rounded border border-arm-gray/70 bg-white p-4 lg:col-span-2">
        <h2 className="mb-1 text-base font-semibold">Средний балл по ученикам: было → стало</h2>
        <p className="mb-3 text-xs text-arm-desc">
          Шкала 0–100, в зачёт — только подтверждённые попытки. <span className="inline-block h-2 w-4 rounded-sm bg-arm-gray align-middle" /> сохранённые веса,{" "}
          <span className="inline-block h-2 w-4 rounded-sm bg-arm-blue align-middle" /> новые.
        </p>
        {byStudent.length ? (
          <ul className="flex flex-col gap-2">
            {byStudent.map((s) => (
              <li key={s.id} className="grid grid-cols-[9rem_minmax(0,1fr)_6.5rem] items-center gap-3 text-sm sm:grid-cols-[14rem_minmax(0,1fr)_7rem]">
                <span className="truncate" title={s.name}>
                  {shortName(s.name)} <span className="text-xs text-arm-desc">· {s.n}</span>
                </span>
                <div className="flex flex-col gap-0.5" aria-hidden>
                  <div className="h-2 rounded-sm bg-arm-gray" style={{ width: `${s.before ?? 0}%` }} />
                  <div className="h-2 rounded-sm bg-arm-blue" style={{ width: `${s.after ?? 0}%` }} />
                </div>
                <span className="text-right tabular-nums">
                  {s.before ?? "—"} → <b>{s.after ?? "—"}</b>
                </span>
              </li>
            ))}
            <li className="grid grid-cols-[9rem_minmax(0,1fr)_6.5rem] gap-3 text-[11px] text-arm-desc sm:grid-cols-[14rem_minmax(0,1fr)_7rem]">
              <span />
              <span className="flex justify-between">
                <span>0</span>
                <span>50</span>
                <span>100</span>
              </span>
              <span />
            </li>
          </ul>
        ) : (
          <p className="text-sm text-arm-desc">Подтверждённых попыток пока нет.</p>
        )}
      </section>

      <section className="rounded border border-arm-gray/70 bg-white p-4">
        <h2 className="mb-2 text-base font-semibold">По занятиям</h2>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-arm-gray/50">
            {byLesson.map((l) => (
              <tr key={l.id}>
                <td className="py-1.5 pr-2">{l.title}</td>
                <td className="py-1.5 text-right text-xs text-arm-desc">{l.n} поп.</td>
                <td className="py-1.5 pl-3 text-right tabular-nums">
                  {l.before ?? "—"} → <b>{l.after ?? "—"}</b>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="rounded border border-arm-gray/70 bg-white p-4">
        <h2 className="mb-2 text-base font-semibold">Больше всего изменились</h2>
        {biggest.length ? (
          <table className="w-full text-sm">
            <tbody className="divide-y divide-arm-gray/50">
              {biggest.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-2">
                    {shortName(r.student)} <span className="text-xs text-arm-desc">· {r.kind === "OP112" ? "112" : "ДДС"} · {r.lessonTitle}</span>
                    {!r.reviewed && <span className="text-xs text-amber-700"> · на проверке</span>}
                  </td>
                  <td className="py-1.5 pl-3 text-right tabular-nums">
                    {r.before ?? "—"} → <b>{r.after ?? "—"}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-arm-desc">Сдвиньте ползунок — здесь появятся попытки, у которых изменится балл.</p>
        )}
      </section>
    </div>
  );
}
