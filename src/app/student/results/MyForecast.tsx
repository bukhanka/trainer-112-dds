import { RangeBar } from "@/components/charts";
import { Section } from "@/components/ui";
import type { StudentForecastView } from "@/lib/adaptive/student";
import { ROLE_LABEL } from "@/lib/adaptive/rating";
import { countLabel, formatDuration } from "@/lib/format";

const signed = (x: number) => {
  const r = Math.round(x);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)}`;
};

/** «Мой прогноз на следующее занятие»: expected score with its interval, the time norm by role, the level. */
export function MyForecast({ view }: { view: StudentForecastView }) {
  const { score, time, risk } = view.forecast;
  const roles = view.levels.filter((l) => l.attempts > 0 || time[l.role]);
  return (
    <Section title="Мой прогноз на следующее занятие">
      {score ? (
        <div className="grid gap-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-4xl font-semibold tabular-nums">{Math.round(score.expected)}</span>
              <span className="text-sm text-arm-desc">ожидаемый балл из 100</span>
            </div>
            <RangeBar low={score.low} high={score.high} expected={score.expected} />
            <div className="flex justify-between text-[11px] text-arm-desc">
              <span>0</span>
              <span>50</span>
              <span>100</span>
            </div>
            <p className="text-sm">
              Скорее всего — от <b className="tabular-nums">{Math.round(score.low)}</b> до <b className="tabular-nums">{Math.round(score.high)}</b>.{" "}
              {Math.abs(score.trend) >= 1 ? (
                <span className={score.trend > 0 ? "text-emerald-700" : "text-red-700"}>
                  {score.trend > 0 ? "Результат растёт" : "Результат снижается"}: {signed(score.trend)} за занятие.
                </span>
              ) : (
                <span className="text-arm-desc">Результат держится ровно.</span>
              )}
            </p>
            <p className="text-xs text-arm-desc">
              По {countLabel(score.lessons, ["занятию", "занятиям", "занятиям"])} и {countLabel(score.attempts, ["проверенной попытке", "проверенным попыткам", "проверенным попыткам"])}.
              Сглаженный средний балл занятий плюс тренд. Интервал — по тому, насколько прогноз ошибался раньше; пока занятий мало, он шире.
            </p>
          </div>
          <ul className="flex flex-col gap-2 text-sm">
            {roles.map((l) => {
              const t = time[l.role];
              return (
                <li key={l.role} className="rounded border border-arm-gray/70 p-3">
                  <div className="font-semibold">{ROLE_LABEL[l.role]}</div>
                  {t ? (
                    <div>
                      Уложиться в норматив {formatDuration(t.normSec)}:{" "}
                      <b className={`tabular-nums ${t.pOnTime >= 0.8 ? "text-emerald-700" : t.pOnTime < 0.5 ? "text-red-700" : "text-amber-800"}`}>{Math.round(t.pOnTime * 100)} %</b>
                      <span className="block text-xs text-arm-desc">
                        обычно {formatDuration(t.typicalSec)}; в норматив — {t.onTime} из {t.attempts} последних
                      </span>
                    </div>
                  ) : (
                    <div className="text-xs text-arm-desc">Время против норматива появится после проверенных попыток.</div>
                  )}
                  {l.attempts > 0 && (
                    <div className="mt-1 text-xs text-arm-desc">
                      Уровень <b className="tabular-nums text-arm-dark">{l.rating}</b> — задания сложности около {l.difficulty} из 10
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {risk.atRisk && (
            <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 md:col-span-2">
              Зона внимания: {risk.reasons.join("; ")}. Разберите «Что подтянуть» ниже — и спросите преподавателя о разборе ошибок.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-arm-desc">Прогноз появится после первого занятия, проверенного преподавателем.</p>
      )}
    </Section>
  );
}
