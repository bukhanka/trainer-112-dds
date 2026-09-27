"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge, buttonClass, fieldClass } from "@/components/ui";
import type { CategoryDraft } from "@/lib/scenarios/by-category";
import { decodeLocation, encodeLocation, type LocationGroup } from "@/lib/scenarios/location";

export type GenerateCategory = { name: string; groups: string[]; types: number; total: number; approved: number };

const COUNTS = [1, 2, 3, 4, 5];

export function GenerateForm({
  categories,
  locations,
  initialCategory,
  initialLocation = "",
  aiMock,
}: {
  categories: GenerateCategory[];
  locations: LocationGroup[];
  initialCategory: string;
  initialLocation?: string;
  aiMock: boolean;
}) {
  const [category, setCategory] = useState(initialCategory);
  const [count, setCount] = useState(3);
  const [difficulty, setDifficulty] = useState("");
  const [location, setLocation] = useState(initialLocation);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<CategoryDraft[] | null>(null);
  const [requested, setRequested] = useState(0);
  const chosen = categories.find((c) => c.name === category);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDrafts(null);
    setPending(true);
    try {
      const res = await fetch("/api/teacher/scenarios/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category, count, difficulty: difficulty ? Number(difficulty) : null, location: decodeLocation(location) }),
      });
      const data = (await res.json().catch(() => ({}))) as { drafts?: CategoryDraft[]; requested?: number; error?: string };
      if (!res.ok || !data.drafts) setError(data.error ?? "Не удалось собрать черновики. Повторите попытку.");
      else {
        setDrafts(data.drafts);
        setRequested(data.requested ?? data.drafts.length);
      }
    } catch {
      setError("Нет связи с сервером. Проверьте сеть и повторите.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 text-sm">
            <label className="flex flex-col gap-1">
              Категория
              <select className={`${fieldClass} h-10`} value={category} onChange={(e) => setCategory(e.target.value)}>
                {categories.map((c) => (
                  <option key={c.name} value={c.name}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            {chosen && (
              <p className="text-xs text-arm-desc">
                Из классификатора: {chosen.groups.join(", ")} — подходящих типов {chosen.types}. В библиотеке сценариев этой категории: {chosen.total},
                утверждено {chosen.approved}.
              </p>
            )}
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Локация: округ или район
            <select className={`${fieldClass} h-10`} value={location} onChange={(e) => setLocation(e.target.value)}>
              <option value="">любая</option>
              {locations.map((g) => (
                <optgroup key={g.okrug} label={g.okrug}>
                  <option value={encodeLocation({ okrug: g.okrug })}>{g.okrug} — весь округ</option>
                  {g.districts.map((d) => (
                    <option key={d.name} value={encodeLocation({ okrug: g.okrug, district: d.name })}>
                      {d.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1 text-sm">
            <span id="count-label">Сколько черновиков</span>
            <div className="inline-flex w-fit divide-x divide-arm-gray overflow-hidden rounded border border-arm-gray" role="group" aria-labelledby="count-label">
              {COUNTS.map((n) => (
                <button
                  key={n}
                  type="button"
                  aria-pressed={count === n}
                  onClick={() => setCount(n)}
                  className={`h-10 w-11 text-sm tabular-nums ${count === n ? "bg-arm-dark text-white" : "bg-white hover:bg-arm-panel"}`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Сложность
            <select className={`${fieldClass} h-10`} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
              <option value="">предложит система</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                  {n === 1 ? " — самый простой" : n === 10 ? " — самый трудный" : ""}
                </option>
              ))}
            </select>
          </label>
        </div>

        <p className="rounded border border-arm-gray/70 bg-arm-panel/50 p-2 text-xs text-arm-desc">
          {aiMock
            ? "Модель ИИ не подключена: рассказ заявителя составится по шаблону из типа происшествия и адреса. Поправьте формулировки перед утверждением."
            : "Рассказ заявителя пишет модель ИИ по образцу билетов: кто звонит, что видит, как называет место и что скажет только на вопросы. Если модель не ответит, рассказ составится по шаблону."}{" "}
          Чем выше сложность, тем менее точно заявитель называет место сначала и тем труднее с ним говорить.
        </p>

        {error && (
          <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
            {error}
          </p>
        )}
        <button disabled={pending || !category} className={`${buttonClass("primary")} self-start`}>
          {pending ? "Собираю черновики… это займёт до минуты" : `Сгенерировать ${count === 1 ? "черновик" : "черновики"}`}
        </button>
      </form>

      {drafts && (
        <section aria-live="polite" className="flex flex-col gap-2 border-t border-arm-gray/60 pt-3">
          <h2 className="text-base font-semibold text-arm-dark">
            Готово: {drafts.length} {drafts.length === 1 ? "черновик" : drafts.length < 5 ? "черновика" : "черновиков"} в разделе «Черновики»
          </h2>
          {drafts.length < requested && (
            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
              Собрано {drafts.length} из {requested}: для этой локации больше не нашлось подходящих улиц и типов. Выберите округ целиком или «любая».
            </p>
          )}
          <ul className="divide-y divide-arm-gray/50 rounded border border-arm-gray/70">
            {drafts.map((d) => (
              <li key={d.id}>
                <Link href={`/teacher/scenarios/${d.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm hover:bg-arm-panel/60">
                  <span className="min-w-0 flex-1 basis-full sm:basis-0">
                    <span className="font-medium">{d.title}</span>
                    <span className="block text-xs text-arm-desc">
                      {d.finalType ?? "тип не определён"} · {d.place} · {d.address} · служб {d.services}
                    </span>
                  </span>
                  <span className="text-xs tabular-nums text-arm-desc">сложность {d.difficulty}</span>
                  <Badge tone={d.usedModel ? "blue" : "neutral"}>{d.usedModel ? "рассказ написал ИИ" : "рассказ по шаблону"}</Badge>
                  <Badge tone="amber">Черновик</Badge>
                </Link>
              </li>
            ))}
          </ul>
          <p className="text-sm">Откройте каждый черновик, проверьте рассказ, тип, службы и адрес и утвердите — только тогда сценарий попадёт в занятия.</p>
          <div className="flex flex-wrap gap-2">
            <Link href={`/teacher/scenarios?status=DRAFT&category=${encodeURIComponent(category)}`} className={buttonClass("secondary")}>
              Все черновики категории
            </Link>
          </div>
        </section>
      )}
    </div>
  );
}
