import { RangeBar } from "@/components/charts";
import { signedWhole } from "@/components/forecast";
import { Section } from "@/components/ui";
import { FORECAST, type TimeForecast } from "@/lib/adaptive/forecast";
import type { GroupForecast } from "@/lib/adaptive/teacher";
import { formatDuration } from "@/lib/format";

function TimeCell({ t, label }: { t: TimeForecast | null; label: string }) {
  if (!t) return null;
  const p = Math.round(t.pOnTime * 100);
  return (
    <span className="block whitespace-nowrap" title={`норматив ${formatDuration(t.normSec)}, обычно ${formatDuration(t.typicalSec)}; в норматив ${t.onTime} из ${t.attempts} последних`}>
      {label}: <b className={`tabular-nums ${t.pOnTime < FORECAST.riskOnTime ? "text-red-700" : t.pOnTime >= 0.8 ? "text-emerald-700" : "text-amber-800"}`}>{p} %</b>
    </span>
  );
}

/** «Прогноз на следующее занятие» for the teacher's groups: who is at risk and why. */
export function GroupForecastSection({ data }: { data: GroupForecast }) {
  return (
    <Section
      title="Прогноз на следующее занятие"
      actions={
        <span className="text-sm">
          в зоне риска: <b className={data.atRisk ? "text-red-700" : "text-emerald-700"}>{data.atRisk}</b> из {data.rows.length}
        </span>
      }
    >
      {data.rows.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="text-left text-xs text-arm-desc">
              <tr className="border-b border-arm-gray/60">
                <th className="py-1.5 pr-3 font-medium">Ученик</th>
                <th className="py-1.5 pr-3 text-right font-medium">Ожидаемый балл</th>
                <th className="w-48 py-1.5 pr-3 font-medium">Интервал, шкала 0–100</th>
                <th className="py-1.5 pr-3 text-right font-medium">Тренд за занятие</th>
                <th className="py-1.5 pr-3 font-medium">Уложится в норматив</th>
                <th className="py-1.5 pr-3 font-medium">Уровень (сложность)</th>
                <th className="py-1.5 font-medium">Зона риска</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-arm-gray/50">
              {data.rows.map((r) => (
                <tr key={r.studentId} className={r.risk.atRisk ? "bg-red-50/50" : ""}>
                  <td className="py-1.5 pr-3">
                    <span className="font-medium">{r.name}</span>
                    <span className="block text-xs text-arm-desc">{r.groups.join(", ")}</span>
                  </td>
                  <td className="py-1.5 pr-3 text-right text-base font-semibold tabular-nums">{r.score ? Math.round(r.score.expected) : "—"}</td>
                  <td className="py-1.5 pr-3">
                    {r.score ? (
                      <>
                        <RangeBar low={r.score.low} high={r.score.high} expected={r.score.expected} />
                        <span className="text-xs tabular-nums text-arm-desc">
                          {Math.round(r.score.low)}–{Math.round(r.score.high)} · по {r.score.lessons} зан.
                        </span>
                      </>
                    ) : (
                      <span className="text-xs text-arm-desc">нет проверенных занятий</span>
                    )}
                  </td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums ${!r.score ? "text-arm-desc" : r.score.trend >= 1 ? "text-emerald-700" : r.score.trend <= -1 ? "text-red-700" : ""}`}>
                    {r.score && r.score.lessons > 1 ? signedWhole(r.score.trend) : "—"}
                  </td>
                  <td className="py-1.5 pr-3 text-xs">
                    <TimeCell t={r.time.OP112} label="112" />
                    <TimeCell t={r.time.DDS} label="ДДС" />
                    {!r.time.OP112 && !r.time.DDS && <span className="text-arm-desc">—</span>}
                  </td>
                  <td className="py-1.5 pr-3 text-xs tabular-nums">
                    {r.levels.OP112.attempts > 0 && (
                      <span className="block whitespace-nowrap">
                        112: <b>{r.levels.OP112.rating}</b> ({r.levels.OP112.difficulty})
                      </span>
                    )}
                    {r.levels.DDS.attempts > 0 && (
                      <span className="block whitespace-nowrap">
                        ДДС: <b>{r.levels.DDS.rating}</b> ({r.levels.DDS.difficulty})
                      </span>
                    )}
                    {!r.levels.OP112.attempts && !r.levels.DDS.attempts && <span className="text-arm-desc">новичок</span>}
                  </td>
                  <td className="py-1.5 text-xs">
                    {r.risk.atRisk ? (
                      <ul className="flex flex-col gap-0.5">
                        {r.risk.reasons.map((reason) => (
                          <li key={reason} className="rounded border border-red-300 bg-red-50 px-1.5 py-0.5 text-red-700">
                            {reason}
                          </li>
                        ))}
                      </ul>
                    ) : r.score ? (
                      <span className="text-emerald-700">нет</span>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-sm text-arm-desc">В ваших группах нет учеников.</p>
      )}
      <p className="mt-2 text-xs text-arm-desc">
        По подтверждённым попыткам ваших занятий. Ожидаемый балл — сглаженный средний балл занятий плюс тренд; интервал рассчитан так, чтобы факт попадал в
        него 8 раз из 10. «Уложится в норматив» — вероятность по времени последних попыток роли. Зона риска: ожидаемый балл ниже {FORECAST.riskScore} или
        вероятность уложиться в норматив ниже {Math.round(FORECAST.riskOnTime * 100)} %. Уровень — рейтинг «как в шахматах» (черновики в нём весят вдвое меньше
        подтверждённых попыток), в скобках — рекомендуемая сложность заданий.
      </p>
    </Section>
  );
}
