"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { PassBadge } from "@/components/pass";
import { Badge, Button, REVIEW_STATUS } from "@/components/ui";
import { countLabel } from "@/lib/format";
import { bulkResultText, type BulkSkips } from "@/lib/review/bulk-text";
import type { PassVerdict } from "@/lib/scoring/pass";

export type AttemptRow = {
  id: string;
  kind: "OP112" | "DDS";
  student: string;
  seat: string | null;
  time: string;
  scenario: string | null;
  incidentNumber: number | null;
  reviewStatus: "PENDING" | "CONFIRMED" | "OVERRIDDEN";
  score: number | null;
  failed: number;
  critical: boolean;
  edited: boolean;
  pass: PassVerdict | null;
};

const attempts = (n: number) => countLabel(n, ["попытку", "попытки", "попыток"]);

/**
 * The attempts of a lesson with «Утвердить выбранные» and «Утвердить все без критичных ошибок»: the drafts the teacher
 * agrees with are confirmed in one action (src/lib/review/bulk.ts), the rest are opened one by one. Rows with a critical
 * error are marked, rows the teacher has already changed are decided on their own screen.
 */
export function AttemptList({ lessonId, rows, canDecide }: { lessonId: string; rows: AttemptRow[]; canDecide: boolean }) {
  const router = useRouter();
  const pending = canDecide ? rows.filter((r) => r.reviewStatus === "PENDING") : [];
  const selectable = pending.filter((r) => !r.edited);
  const clean = selectable.filter((r) => !r.critical);
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const chosen = selectable.filter((r) => picked.has(r.id));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const toggle = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allOn = selectable.length > 0 && chosen.length === selectable.length;

  const run = async (ids: string[], noCritical: boolean, question: string) => {
    if (!ids.length || !window.confirm(question)) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/teacher/lessons/${lessonId}/attempts/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, noCritical }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; confirmed?: number; skipped?: BulkSkips };
      if (!res.ok || data.confirmed == null || !data.skipped) {
        setMessage({ ok: false, text: data.error ?? "Не удалось утвердить — попробуйте ещё раз" });
        return;
      }
      setMessage({ ok: true, text: bulkResultText(data.confirmed, data.skipped) });
      setPicked(new Set());
      router.refresh();
    } catch {
      setMessage({ ok: false, text: "Нет связи с сервером — попробуйте ещё раз" });
    } finally {
      setBusy(false);
    }
  };

  const confirmChosen = () => {
    const critical = chosen.filter((r) => r.critical).length;
    void run(
      chosen.map((r) => r.id),
      false,
      `Утвердить как есть ${attempts(chosen.length)}${critical ? `, из них с критичной ошибкой — ${critical}` : ""}?\n\nБалл и зачёт — по черновику, как кнопка «Верно» на экране попытки. Каждое решение запишется в журнал аудита; вернуть попытку на проверку можно на её экране.`,
    );
  };

  const confirmClean = () => {
    const left = pending.length - clean.length;
    const stays = left % 10 === 1 && left % 100 !== 11 ? "останется" : "останутся";
    void run(
      pending.map((r) => r.id),
      true,
      `Утвердить как есть ${attempts(clean.length)} без критичных ошибок?\n\nБалл и зачёт — по черновику, как кнопка «Верно» на экране попытки. Каждое решение запишется в журнал аудита.${left ? ` На проверке ${stays} ${countLabel(left, ["попытка", "попытки", "попыток"])} с критичной ошибкой или с вашими правками — их решите по одной.` : ""}`,
    );
  };

  return (
    <div className="flex flex-col gap-2">
      {(pending.length > 0 || message) && (
        <div className="flex flex-col gap-2 rounded border border-arm-gray/70 bg-white p-3">
          {pending.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <label className="mr-2 inline-flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-arm-blue"
                    checked={allOn}
                    ref={(el) => {
                      if (el) el.indeterminate = chosen.length > 0 && !allOn;
                    }}
                    disabled={!selectable.length || busy}
                    onChange={() => setPicked(allOn ? new Set() : new Set(selectable.map((r) => r.id)))}
                  />
                  Выбрать все на проверке ({selectable.length})
                </label>
                <Button variant="success" size="sm" disabled={!chosen.length || busy} onClick={confirmChosen}>
                  Утвердить выбранные ({chosen.length})
                </Button>
                <Button variant="secondary" size="sm" disabled={!clean.length || busy} onClick={confirmClean}>
                  Утвердить все без критичных ошибок ({clean.length})
                </Button>
              </div>
              <p className="text-xs text-arm-desc">
                Утвердить списком — то же, что «Верно» на экране попытки: балл и зачёт по черновику, каждое решение — в журнале аудита. Попытки с критичной
                ошибкой отмечены красным: их лучше открыть. Попытку, где вы уже меняли проверки или писали комментарий, решите на её экране.
              </p>
            </>
          )}
          {message && (
            <p role="status" className={`rounded border p-2 text-sm ${message.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-800"}`}>
              {message.text}
            </p>
          )}
        </div>
      )}

      <ul className="divide-y divide-arm-gray/50 rounded border border-arm-gray/70 bg-white">
        {rows.map((a) => {
          const st = REVIEW_STATUS[a.reviewStatus];
          const canPick = pending.length > 0 && a.reviewStatus === "PENDING" && !a.edited;
          const label = `${a.student}, ${a.scenario ?? "карточка"}`;
          return (
            <li key={a.id} className="flex items-stretch">
              {pending.length > 0 && (
                <label
                  className="flex w-10 shrink-0 cursor-pointer items-center justify-center border-r border-arm-gray/40 hover:bg-arm-panel/60"
                  title={a.reviewStatus !== "PENDING" ? "Уже решено" : a.edited ? "Вы уже меняли эту попытку — решите на её экране" : "Выбрать для утверждения"}
                >
                  {a.reviewStatus === "PENDING" && (
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-arm-blue"
                      aria-label={`Выбрать: ${label}`}
                      checked={picked.has(a.id) && canPick}
                      disabled={!canPick || busy}
                      onChange={() => toggle(a.id)}
                    />
                  )}
                </label>
              )}
              <Link
                href={`/teacher/attempts/${a.id}`}
                className="grid min-w-0 flex-1 gap-x-4 gap-y-1 px-3 py-2.5 text-sm hover:bg-arm-panel/60 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_6rem_7rem_12.5rem] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{a.student}</div>
                  <div className="text-xs text-arm-desc">
                    {a.seat} · {a.kind === "OP112" ? "112" : "ДДС"} · {a.time}
                  </div>
                </div>
                <div className="min-w-0 truncate">
                  {a.incidentNumber && (
                    <span className="text-xs text-arm-desc">
                      № <span className="font-mono">{a.incidentNumber}</span> ·{" "}
                    </span>
                  )}
                  {a.scenario ?? "Карточка"}
                </div>
                <div className={a.failed ? "font-medium text-red-700" : "text-emerald-700"}>
                  {a.failed ? `ошибок ${a.failed}` : "без ошибок"}
                  {a.critical && <span className="block text-xs">критичная</span>}
                </div>
                <div className="tabular-nums">
                  {a.score == null ? "—" : a.reviewStatus === "PENDING" ? <span className="text-arm-desc">{a.score} (черновик)</span> : <b>{a.score}</b>}
                  <span className="block">
                    <PassBadge verdict={a.pass} draft={a.reviewStatus === "PENDING"} />
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  <Badge tone={st.tone}>{st.label}</Badge>
                  {a.edited && a.reviewStatus === "PENDING" && <Badge tone="blue">с вашими правками</Badge>}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
