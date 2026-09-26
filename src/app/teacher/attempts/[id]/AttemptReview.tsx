"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge, Button, REVIEW_STATUS } from "@/components/ui";
import type { AiDraft } from "@/lib/review/draft";
import { applyOverrides, computeScore, WEIGHT_GROUPS, type CriterionResult, type Overrides, type WeightGroup, type Weights } from "@/lib/scoring/score";

type Verdict = boolean | null;

export type AttemptReviewProps = {
  id: string;
  criteria: CriterionResult[];
  override: Overrides | null;
  draft: AiDraft | null;
  reviewStatus: "PENDING" | "CONFIRMED" | "OVERRIDDEN";
  teacherComment: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  weights: Weights;
  locked: string | null;
  nextPendingId: string | null;
};

const VERDICTS: { value: Verdict; label: string; cls: string }[] = [
  { value: true, label: "Верно", cls: "bg-emerald-700 text-white border-emerald-700" },
  { value: false, label: "Ошибка", cls: "bg-red-600 text-white border-red-600" },
  { value: null, label: "Не применимо", cls: "bg-arm-desc text-white border-arm-desc" },
];

function VerdictMark({ ok }: { ok: Verdict }) {
  if (ok === null) return <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-arm-panel text-sm text-arm-desc" title="Не применимо">—</span>;
  return ok ? (
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700" title="Верно">
      ✓
    </span>
  ) : (
    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-100 text-sm font-bold text-red-700" title="Ошибка">
      ✕
    </span>
  );
}

export function AttemptReview(p: AttemptReviewProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [verdicts, setVerdicts] = useState<Record<string, Verdict>>(() => Object.fromEntries(applyOverrides(p.criteria, p.override).map((c) => [c.code, c.ok])));
  const [comment, setComment] = useState(p.teacherComment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const draftScore = computeScore(p.criteria, p.weights, null);
  const savedScore = computeScore(p.criteria, p.weights, p.override);
  const editScore = computeScore(p.criteria, p.weights, verdicts);
  const changed = p.criteria.filter((c) => verdicts[c.code] !== c.ok);
  const st = REVIEW_STATUS[p.reviewStatus];

  async function send(body: unknown, message: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/teacher/attempts/${p.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Не удалось сохранить");
        return;
      }
      setEditing(false);
      setDone(message);
      router.refresh();
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  async function makeDraft() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/teacher/attempts/${p.id}/draft`, { method: "POST" });
      if (!res.ok) setError("Не удалось подготовить черновик");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const shown = editing ? p.criteria.map((c) => ({ ...c, ok: verdicts[c.code] })) : applyOverrides(p.criteria, p.override);
  const groups = (Object.keys(WEIGHT_GROUPS) as WeightGroup[]).filter((g) => shown.some((c) => c.group === g));
  const original = new Map(p.criteria.map((c) => [c.code, c.ok]));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <div className="flex flex-col gap-4 lg:col-start-1 lg:row-start-1">
        <section className="rounded border border-arm-gray/70 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">{p.draft?.source === "ai" ? "Черновик ИИ" : "Черновик оценки"}</h2>
            <Badge tone={p.draft?.source === "ai" ? "blue" : "neutral"}>{p.draft?.source === "ai" ? `модель ${p.draft.model ?? ""}` : "по правилам"}</Badge>
            <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={makeDraft}>
              {p.draft ? "Обновить черновик" : "Подготовить черновик"}
            </Button>
          </div>
          {p.draft ? (
            <>
              <p className="text-sm">{p.draft.summary}</p>
              {p.draft.recommendations && p.draft.recommendations.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-arm-desc">
                  {p.draft.recommendations.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="text-sm text-arm-desc">Черновика пока нет — ниже результаты проверок по правилам.</p>
          )}
          <p className="mt-2 text-xs text-arm-desc">Черновик — подсказка. Решение за преподавателем: без него попытка не идёт в зачёт и в отчёты.</p>
        </section>

        {groups.map((g) => (
          <section key={g} className="rounded border border-arm-gray/70 bg-white">
            <h3 className="flex items-center gap-2 border-b border-arm-gray/60 px-4 py-2 text-sm font-semibold">
              {WEIGHT_GROUPS[g]}
              <span className="text-xs font-normal text-arm-desc">вес {p.weights[g]}</span>
            </h3>
            <ul className="divide-y divide-arm-gray/40">
              {shown
                .filter((c) => c.group === g)
                .map((c) => {
                  const was = original.get(c.code);
                  const flipped = was !== c.ok;
                  const aiNote = p.draft?.comments?.[c.code];
                  return (
                    <li key={c.code} className={`flex gap-3 px-4 py-3 ${c.ok === false ? "bg-red-50/40" : ""}`}>
                      <VerdictMark ok={c.ok} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
                          {c.title}
                          {c.critical && <Badge tone="red">критично</Badge>}
                          <Badge tone={c.source === "ai" ? "blue" : "neutral"}>{c.source === "ai" ? "оценил ИИ" : "правило"}</Badge>
                          {flipped && (
                            <Badge tone="amber">
                              было: {was === null ? "не применимо" : was ? "верно" : "ошибка"} → изменил преподаватель
                            </Badge>
                          )}
                        </div>
                        {c.evidence && <p className="mt-1 border-l-2 border-arm-gray pl-2 text-sm text-arm-dark">{c.evidence}</p>}
                        {c.expected && (
                          <p className="mt-1 text-sm text-emerald-800">
                            <span className="text-arm-desc">Как надо: </span>
                            {c.expected}
                          </p>
                        )}
                        {aiNote && !editing && p.draft?.source === "ai" && <p className="mt-1 text-xs text-arm-blue">ИИ: {aiNote}</p>}
                        {editing && (
                          <div className="mt-2 inline-flex overflow-hidden rounded border border-arm-gray text-xs" role="group" aria-label={`Вердикт: ${c.title}`}>
                            {VERDICTS.map((v) => (
                              <button
                                key={String(v.value)}
                                type="button"
                                aria-pressed={verdicts[c.code] === v.value}
                                onClick={() => setVerdicts((all) => ({ ...all, [c.code]: v.value }))}
                                className={`px-2.5 py-1 ${verdicts[c.code] === v.value ? v.cls : "bg-white hover:bg-arm-panel"}`}
                              >
                                {v.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
            </ul>
          </section>
        ))}
        {!groups.length && <p className="rounded border border-dashed border-arm-gray bg-white p-4 text-sm text-arm-desc">В попытке нет проверок.</p>}
      </div>

      <aside className="order-first flex flex-col gap-3 lg:sticky lg:top-4 lg:order-none lg:col-start-2 lg:row-start-1 lg:self-start">
        <section className="rounded border border-arm-gray/70 bg-white p-4">
          <div className="flex items-center gap-2">
            <Badge tone={st.tone}>{st.label}</Badge>
          </div>
          <div className="mt-3 text-sm text-arm-desc">{p.reviewStatus === "PENDING" ? "Черновой балл (не в зачёте)" : "Балл"}</div>
          <div className="flex items-baseline gap-2">
            <span className="text-4xl font-bold tabular-nums">{editing ? (editScore ?? "—") : (p.reviewStatus === "PENDING" ? draftScore : savedScore) ?? "—"}</span>
            <span className="text-sm text-arm-desc">из 100</span>
          </div>
          {editing && editScore !== draftScore && (
            <div className="text-sm text-arm-desc">
              черновик {draftScore ?? "—"} → с вашими правками {editScore ?? "—"}
            </div>
          )}
          {p.reviewedBy && p.reviewStatus !== "PENDING" && (
            <div className="mt-2 text-xs text-arm-desc">
              {p.reviewedBy}, {p.reviewedAt}
            </div>
          )}
          {p.teacherComment && !editing && (
            <p className="mt-2 rounded bg-arm-panel p-2 text-sm">
              <span className="text-xs text-arm-desc">Комментарий преподавателя: </span>
              {p.teacherComment}
            </p>
          )}
        </section>

        {p.locked ? (
          <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">{p.locked}</p>
        ) : editing ? (
          <section className="flex flex-col gap-2 rounded border-2 border-arm-blue bg-white p-4">
            <div className="text-sm font-semibold">ИИ неправ — как надо</div>
            <p className="text-xs text-arm-desc">Переключите вердикты у проверок. Изменено: {changed.length}.</p>
            <textarea
              className="min-h-24 rounded border border-arm-gray p-2 text-sm outline-none focus:border-arm-blue"
              placeholder="Комментарий ученику: что было не так и как правильно"
              value={comment}
              maxLength={2000}
              onChange={(e) => setComment(e.target.value)}
            />
            <Button variant="primary" disabled={busy || !changed.length || !comment.trim()} onClick={() => send({ action: "override", override: verdicts, comment }, "Исправление сохранено")}>
              Сохранить исправление
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setVerdicts(Object.fromEntries(applyOverrides(p.criteria, p.override).map((c) => [c.code, c.ok])));
              }}
            >
              Отмена
            </Button>
          </section>
        ) : (
          <section className="flex flex-col gap-2 rounded border border-arm-gray/70 bg-white p-4">
            {p.reviewStatus === "PENDING" ? (
              <>
                <textarea
                  className="min-h-16 rounded border border-arm-gray p-2 text-sm outline-none focus:border-arm-blue"
                  placeholder="Комментарий или рекомендация ученику (необязательно)"
                  value={comment}
                  maxLength={2000}
                  onChange={(e) => setComment(e.target.value)}
                  aria-label="Комментарий ученику"
                />
                <Button variant="success" disabled={busy} onClick={() => send({ action: "confirm", comment: comment.trim() || undefined }, "Оценка подтверждена")}>
                  ✓ Верно — подтвердить
                </Button>
                <Button
                  variant="danger"
                  disabled={busy || !p.criteria.length}
                  onClick={() => {
                    setVerdicts(Object.fromEntries(p.criteria.map((c) => [c.code, c.ok])));
                    setEditing(true);
                  }}
                >
                  ✕ ИИ неправ — исправить
                </Button>
              </>
            ) : (
              <>
                <Button
                  disabled={busy || !p.criteria.length}
                  onClick={() => {
                    setVerdicts(Object.fromEntries(applyOverrides(p.criteria, p.override).map((c) => [c.code, c.ok])));
                    setEditing(true);
                  }}
                >
                  Изменить решение
                </Button>
                <Button variant="ghost" disabled={busy} onClick={() => send({ action: "reopen" }, "Попытка возвращена на проверку")}>
                  Вернуть на проверку
                </Button>
              </>
            )}
          </section>
        )}
        {error && (
          <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
            {error}
          </p>
        )}
        {done && (
          <p role="status" className="rounded border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-900">
            {done}.{" "}
            {p.nextPendingId && (
              <Link href={`/teacher/attempts/${p.nextPendingId}`} className="font-medium text-arm-blue underline">
                Следующая на проверке →
              </Link>
            )}
          </p>
        )}
        {!done && p.nextPendingId && (
          <Link href={`/teacher/attempts/${p.nextPendingId}`} className="text-right text-sm text-arm-blue hover:underline">
            Следующая на проверке →
          </Link>
        )}
      </aside>
    </div>
  );
}
