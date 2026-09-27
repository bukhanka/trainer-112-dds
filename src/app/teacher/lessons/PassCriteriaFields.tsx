"use client";

import { useState } from "react";
import { inputClass } from "@/components/ui";
import { matchTemplate, parseTemplates, templateProblem, TEMPLATE_MAX_LENGTH } from "@/lib/scoring/template";

type Criteria = { passScore: number; maxCritical: number; commentTemplate: string };

/**
 * «Критерии зачёта» of the lesson form (ТЗ п.99): the pass mark, the failed critical checks allowed and an
 * optional phrase the final comment of a ДДС place must contain — with a field to try it on an example.
 */
export function PassCriteriaFields({ value, onChange }: { value: Criteria; onChange: (patch: Partial<Criteria>) => void }) {
  const [score, setScore] = useState(String(value.passScore));
  const [shown, setShown] = useState(value.passScore);
  const [sample, setSample] = useState("");
  if (shown !== value.passScore) {
    // Changed from outside (defaults of another lesson): show it.
    setShown(value.passScore);
    setScore(String(value.passScore));
  }
  const commit = () => {
    const v = Math.round(Number(score));
    const next = score.trim() !== "" && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : value.passScore;
    setScore(String(next));
    setShown(next);
    if (next !== value.passScore) onChange({ passScore: next });
  };

  const templates = parseTemplates(value.commentTemplate);
  const problems = templates.map(templateProblem).filter((p): p is string => !!p);
  const tried = sample.trim() && templates.length ? matchTemplate(sample, templates) : null;

  return (
    <fieldset className="flex flex-col gap-3 rounded border border-arm-gray/70 p-3">
      <legend className="px-1 text-sm font-medium">Критерии зачёта</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          Зачёт: балл не ниже
          <input
            type="number"
            inputMode="numeric"
            className={inputClass}
            min={0}
            max={100}
            value={score}
            onChange={(e) => {
              setScore(e.target.value);
              const v = Math.round(Number(e.target.value));
              if (e.target.value.trim() !== "" && Number.isFinite(v) && v >= 0 && v <= 100) {
                setShown(v);
                onChange({ passScore: v });
              }
            }}
            onBlur={commit}
          />
          <span className="text-xs text-arm-desc">от 0 до 100, по умолчанию 70</span>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Допустимо критичных ошибок
          <select className={inputClass} value={value.maxCritical} onChange={(e) => onChange({ maxCritical: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? "ни одной" : n}
              </option>
            ))}
          </select>
          <span className="text-xs text-arm-desc">Критичные: похожая улица, отказ от профильного происшествия, карточка без ответа</span>
        </label>
      </div>

      <label className="flex flex-col gap-1 text-sm">
        Шаблон итогового комментария ДДС (необязательно)
        <textarea
          className={`${inputClass} h-auto min-h-16 py-2`}
          rows={2}
          maxLength={TEMPLATE_MAX_LENGTH}
          placeholder={"Наряд № {номер} направлен…\nСообщение принято…"}
          value={value.commentTemplate}
          onChange={(e) => onChange({ commentTemplate: e.target.value })}
        />
        <span className="text-xs text-arm-desc">
          Комментарий места ДДС к «Работы завершены» должен содержать эту фразу; к «Не принята» и «Отказу» шаблон не применяется. {"{номер}"} — число, {"{время}"} — время 14:05, {"{что угодно}"} — любые слова,
          «…» — дальше любой текст. Несколько вариантов — каждый с новой строки. Не совпало — ошибка в группе «Комментарии» с образцом.
        </span>
      </label>
      {problems.length > 0 && (
        <p role="alert" className="text-sm text-red-700">
          {problems.join(". ")}. Такой вариант проверяться не будет.
        </p>
      )}
      {templates.length > 0 && (
        <label className="flex flex-col gap-1 text-sm">
          Проверить шаблон на примере
          <span className="flex flex-wrap items-center gap-2">
            <input className={`${inputClass} flex-1`} placeholder="Наряд № 23 направлен, течь устранена" value={sample} onChange={(e) => setSample(e.target.value)} />
            {tried && (
              <span role="status" className={`text-sm font-medium ${tried.ok ? "text-emerald-700" : "text-red-700"}`}>
                {tried.ok ? "✓ подходит" : "✕ не подходит"}
              </span>
            )}
          </span>
        </label>
      )}
    </fieldset>
  );
}
