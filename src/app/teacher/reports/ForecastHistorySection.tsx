import Link from "next/link";
import { ForecastScatter } from "@/components/charts";
import { AccuracyStats, GainCell, points, SyntheticCheck } from "@/components/forecast";
import { Section } from "@/components/ui";
import type { ForecastHistory } from "@/lib/adaptive/teacher";
import { formatDate, shortName } from "@/lib/format";

/** «Прогноз ↔ факт по занятиям»: every forecast saved at a lesson start against the confirmed result. */
export function ForecastHistorySection({ data }: { data: ForecastHistory }) {
  return (
    <Section title="Прогноз ↔ факт по занятиям">
      {data.lessons.length ? (
        <div className="flex flex-col gap-4">
          <AccuracyStats acc={data.overall} what={["пара «ученик — занятие»", "пары «ученик — занятие»", "пар «ученик — занятие»"]} />
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
            {data.points.length ? (
              <ForecastScatter
                points={data.points.map((p) => ({
                  key: p.key,
                  x: p.expected,
                  y: p.fact,
                  inside: p.inside,
                  title: `${shortName(p.name)} · ${p.lesson}: прогноз ${Math.round(p.expected)} (${Math.round(p.low)}–${Math.round(p.high)}), факт ${Math.round(p.fact)}`,
                }))}
              />
            ) : (
              <p className="text-sm text-arm-desc">Факт появится, когда преподаватель подтвердит попытки занятий с сохранённым прогнозом.</p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead className="text-left text-xs text-arm-desc">
                  <tr className="border-b border-arm-gray/60">
                    <th className="py-1.5 pr-3 font-medium">Занятие</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Сравнено</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Ошибка</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Простое среднее</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Разница</th>
                    <th className="py-1.5 text-right font-medium">В интервале</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-arm-gray/50">
                  {data.lessons.map((l) => (
                    <tr key={l.lessonId}>
                      <td className="py-1.5 pr-3">
                        <Link href={`/teacher/lessons/${l.lessonId}/report`} className="font-medium text-arm-blue hover:underline">
                          {l.title}
                        </Link>
                        <span className="block text-xs text-arm-desc">{formatDate(l.startedAt)}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        {l.accuracy.n} из {l.snapshots}
                      </td>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-right font-semibold tabular-nums">{l.accuracy.mae == null ? "—" : points(l.accuracy.mae)}</td>
                      <td className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums text-arm-desc">{l.accuracy.baselineMae == null ? "—" : points(l.accuracy.baselineMae)}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">
                        <GainCell gain={l.accuracy.gain} />
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{l.accuracy.n ? `${l.accuracy.inside} из ${l.accuracy.n}` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-arm-desc">
                «Сравнено» — ученики, у которых есть и прогноз (было хотя бы одно проверенное занятие до старта), и подтверждённый факт. Ошибка — средняя
                абсолютная разница прогноза и факта в баллах; «простое среднее» — та же ошибка у прогноза «средний балл прошлых занятий»; «разница» —
                на сколько баллов прогноз оказался ближе к факту (зелёное) или дальше (красное). Занятия, где прогноз хуже, не скрываются.
              </p>
            </div>
          </div>
          <SyntheticCheck />
        </div>
      ) : (
        <p className="text-sm text-arm-desc">
          Прогноз сохраняется в момент старта занятия. После того как занятие пройдёт и попытки будут подтверждены, здесь появится сверка прогноза с фактом.
        </p>
      )}
    </Section>
  );
}
