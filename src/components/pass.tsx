/** «Зачтено / не зачтено» of an attempt by the criteria of its lesson (src/lib/scoring/pass.ts). */
import { Badge } from "@/components/ui";
import type { PassVerdict } from "@/lib/scoring/pass";

/** A draft verdict (the attempt is still on review) is grey: it becomes final when the teacher confirms it. */
export function PassBadge({ verdict, draft = false }: { verdict: PassVerdict | null; draft?: boolean }) {
  if (!verdict) return null;
  const why = verdict.passed ? "критерии зачёта занятия выполнены" : `не зачтено: ${verdict.reasons.join("; ")}`;
  return (
    <span title={draft ? `По черновику, до подтверждения — ${why}` : why} className="inline-flex">
      <Badge tone={draft ? "neutral" : verdict.passed ? "green" : "red"}>{verdict.passed ? "зачтено" : "не зачтено"}</Badge>
    </span>
  );
}

/** The verdict with its reasons spelled out — for screens where there is no hover (phones). */
export function PassLine({ verdict, draft = false, rules }: { verdict: PassVerdict | null; draft?: boolean; rules?: string }) {
  if (!verdict) return rules ? <p className="text-xs text-arm-desc">Зачёт: {rules}. Балла нет — оценить нечего.</p> : null;
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-arm-desc">{draft ? "Зачёт по черновику:" : "Зачёт:"}</span>
        <PassBadge verdict={verdict} />
      </div>
      {!verdict.passed && <p className={`mt-1 ${draft ? "text-arm-desc" : "text-red-800"}`}>{verdict.reasons.join("; ")}</p>}
      {rules && <p className="mt-1 text-xs text-arm-desc">Критерии занятия: {rules}.</p>}
    </div>
  );
}
