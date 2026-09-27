import { BarChart, niceMax } from "@/components/charts";
import { Section } from "@/components/ui";
import { countLabel, formatDuration } from "@/lib/format";
import { getReaction, type Reaction, type RoleReaction } from "@/lib/student/reaction";
import type { ViewerSession } from "@/lib/student/results";

const LABEL = { DDS: "ДДС: «Принята / Не принята»", OP112: "112: набор карточки" } as const;
const SHORT = { DDS: "ДДС: ответ", OP112: "112: набор" } as const;
const FROM = { DDS: "от «Добавлена» до первого ответа службы", OP112: "от «Принять» до «сохранить»" } as const;

/** «Время реакции»: the average first-answer time by role against the norm, confirmed attempts only. */
export function MyReaction({ reaction }: { reaction: Reaction }) {
  const rows = [reaction.DDS, reaction.OP112].filter((r): r is RoleReaction => !!r);
  const max = niceMax(Math.max(0, ...rows.map((r) => Math.max(r.avgSec, r.normSec) * 1.15)), 30);
  return (
    <Section title="Время реакции">
      {rows.length ? (
        <div className="flex flex-col gap-3">
          <BarChart
            unit="с"
            max={max}
            labelWidth="6.5rem"
            markerLabel="норматив"
            bars={rows.map((r) => ({
              key: r.role,
              label: SHORT[r.role],
              value: r.avgSec,
              marker: r.normSec,
              valueLabel: formatDuration(r.avgSec),
              tone: r.avgSec <= r.normSec ? "green" : "red",
              title: `${LABEL[r.role]}: в среднем ${formatDuration(r.avgSec)}, норматив ${formatDuration(r.normSec)}`,
            }))}
          />
          <ul className="grid gap-2 text-sm md:grid-cols-2">
            {rows.map((r) => {
              const late = r.avgSec > r.normSec;
              return (
                <li key={r.role} className="rounded border border-arm-gray/70 p-3">
                  <div className="font-semibold">{LABEL[r.role]}</div>
                  <div>
                    В среднем <b className={`tabular-nums ${late ? "text-red-700" : "text-emerald-700"}`}>{formatDuration(r.avgSec)}</b> при нормативе{" "}
                    <b className="tabular-nums">{formatDuration(r.normSec)}</b>
                    {late ? ` — медленнее на ${formatDuration(r.avgSec - r.normSec)}` : ""}.
                  </div>
                  <div className="text-xs text-arm-desc">
                    Обычно {formatDuration(r.medianSec)}; в норматив — {r.onTime} из {countLabel(r.attempts, ["попытки", "попыток", "попыток"])}. Считается {FROM[r.role]}.
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-arm-desc">Время реакции появится после попыток, проверенных преподавателем.</p>
      )}
    </Section>
  );
}

/** The section with its own data, so the results page only places it. */
export async function MyReactionSection({ studentId, viewer }: { studentId: string; viewer?: ViewerSession }) {
  return <MyReaction reaction={await getReaction(studentId, viewer)} />;
}
