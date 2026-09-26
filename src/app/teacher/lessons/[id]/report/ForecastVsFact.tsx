import { ForecastChart } from "@/components/charts";
import { AccuracyStats, signedPoints } from "@/components/forecast";
import { Section } from "@/components/ui";
import type { LessonForecast } from "@/lib/adaptive/snapshot";
import { shortName } from "@/lib/format";

export function ForecastVsFact({ data, status }: { data: LessonForecast; status: "DRAFT" | "RUNNING" | "FINISHED" }) {
  const rows = data.rows.filter((r) => r.snapshot?.expected != null);
  const noHistory = data.rows.filter((r) => r.snapshot && r.snapshot.expected == null);
  return (
    <Section title="Прогноз ↔ факт">
      {!data.snapshots ? (
        <p className="text-sm text-arm-desc">
          {status === "DRAFT"
            ? "Прогноз по каждому ученику сохранится в момент старта занятия, а после проверки попыток здесь появится сверка с фактом."
            : "Для этого занятия прогноз не сохранён: оно началось раньше, чем в тренажёре появился прогноз, или при старте его не удалось посчитать (см. журнал сервера)."}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <AccuracyStats acc={data.accuracy} what={["ученик", "ученика", "учеников"]} />
          {rows.length > 0 && (
            <ForecastChart
              labelWidth="12rem"
              rows={rows.map((r) => ({
                key: r.studentId,
                label: `${shortName(r.name)} · ${r.role === "OP112" ? "112" : "ДДС"}`,
                title: r.name,
                low: r.snapshot!.low!,
                high: r.snapshot!.high!,
                expected: r.snapshot!.expected!,
                fact: r.fact,
                valueLabel: r.fact == null ? `прогноз ${Math.round(r.snapshot!.expected!)} · факт ждёт проверки` : `прогноз ${Math.round(r.snapshot!.expected!)} · факт ${Math.round(r.fact)}`,
              }))}
            />
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="text-left text-xs text-arm-desc">
                <tr className="border-b border-arm-gray/60">
                  <th className="py-1.5 pr-3 font-medium">Ученик</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Уровень на старте</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Прогноз</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Интервал</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Факт</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Ошибка</th>
                  <th className="py-1.5 font-medium">В норматив: прогноз → факт</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-arm-gray/50">
                {data.rows.map((r) => {
                  const s = r.snapshot;
                  return (
                    <tr key={r.studentId}>
                      <td className="py-1.5 pr-3">
                        <span className="font-medium">{r.name}</span> <span className="text-xs text-arm-desc">· {r.seat}</span>
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{s ? `${s.rating} (${s.difficulty})` : "—"}</td>
                      <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">{s?.expected != null ? Math.round(s.expected) : "—"}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-arm-desc">{s?.low != null && s.high != null ? `${Math.round(s.low)}–${Math.round(s.high)}` : "—"}</td>
                      <td className="py-1.5 pr-3 text-right font-semibold tabular-nums">
                        {r.fact != null ? Math.round(r.fact) : <span className="text-xs font-normal text-amber-700">{r.pending ? `на проверке ${r.pending}` : "нет попыток"}</span>}
                      </td>
                      <td className={`py-1.5 pr-3 text-right tabular-nums ${r.inside === false ? "font-semibold text-red-700" : ""}`}>{r.error != null ? signedPoints(r.error) : "—"}</td>
                      <td className="py-1.5 tabular-nums">
                        {s?.pOnTime != null ? `${Math.round(s.pOnTime * 100)} %` : "—"}
                        {r.onTime && (
                          <>
                            {" "}
                            → {r.onTime.met} из {r.onTime.total}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-arm-desc">
            Прогноз сохранён в момент старта занятия по подтверждённым попыткам прошлых занятий и больше не пересчитывается. Факт — средний подтверждённый
            балл ученика на этом занятии. Ошибка = факт − прогноз; средняя абсолютная ошибка — среднее |ошибок| в баллах. «Простое среднее» — прогноз без
            тренда (средний балл прошлых занятий), чтобы было с чем сравнить.
            {noHistory.length > 0 && ` Без прогноза (не было проверенных занятий): ${noHistory.map((r) => shortName(r.name)).join(", ")}.`}
          </p>
        </div>
      )}
    </Section>
  );
}
