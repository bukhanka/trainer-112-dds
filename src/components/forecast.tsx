/** Pieces of «прогноз ↔ факт» shared by the lesson report and «Отчёты». */
import { Stat } from "@/components/ui";
import type { Accuracy } from "@/lib/adaptive/forecast";
import check from "@/lib/adaptive/forecast-check.json";
import { countLabel, plural } from "@/lib/format";

const num = (x: number) => x.toLocaleString("ru-RU", { maximumFractionDigits: 1 });

/** «6,2 балла», «5 баллов», «1 балл». */
export function points(x: number): string {
  const r = Math.round(x * 10) / 10;
  return Number.isInteger(r) ? `${r} ${plural(r, ["балл", "балла", "баллов"])}` : `${num(r)} балла`;
}

/** «+2,5» / «−3» / «0». */
export const signedPoints = (x: number) => `${x > 0 ? "+" : x < 0 ? "−" : ""}${num(Math.abs(x))}`;

/** Rounded to a whole number first, so 0,3 is «0», not «+0». */
export function signedWhole(x: number): string {
  const r = Math.round(x);
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r)}`;
}

/**
 * How the forecast compares with the plain average of past lessons, in words. A difference smaller than
 * two standard errors of the paired differences is called what it is — within chance.
 */
export function gainVerdict(acc: Accuracy): { text: string; tone?: "red" | "green" } {
  if (acc.gain == null) return { text: "простое среднее прошлых занятий — для сравнения" };
  if (Math.round(acc.gain * 10) === 0) return { text: "точность одинаковая" };
  const what = acc.gain > 0 ? `прогноз точнее на ${points(acc.gain)}` : `прогноз хуже на ${points(-acc.gain)}`;
  if (acc.gainSe == null) return { text: `${what} — по одной паре сравнивать рано` };
  const margin = num(Math.round(2 * acc.gainSe * 10) / 10);
  if (Math.abs(acc.gain) < 2 * acc.gainSe) return { text: `${what} — в пределах случайности (±${margin})` };
  return { text: `${what} (±${margin})`, tone: acc.gain > 0 ? "green" : "red" };
}

/** Four numbers of forecast accuracy, shared by the lesson report and «Отчёты». */
export function AccuracyStats({ acc, what }: { acc: Accuracy; what: [string, string, string] }) {
  const verdict = gainVerdict(acc);
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Ошибка прогноза (средняя абсолютная)" value={acc.mae == null ? "—" : points(acc.mae)} hint={acc.n ? `сравнено: ${countLabel(acc.n, what)}` : "факта ещё нет"} />
      <Stat label="Факт в интервале прогноза" value={acc.n ? `${acc.inside} из ${acc.n}` : "—"} hint="интервал рассчитан на 8 из 10" />
      <Stat
        label="Ошибка простого среднего прошлых занятий"
        value={acc.baselineMae == null ? "—" : points(acc.baselineMae)}
        hint={<span className={verdict.tone === "green" ? "text-emerald-700" : verdict.tone === "red" ? "text-red-700" : undefined}>{verdict.text}</span>}
      />
      <Stat
        label="Смещение: факт − прогноз"
        value={acc.bias == null ? "—" : signedPoints(acc.bias)}
        hint={acc.bias == null ? undefined : Math.abs(acc.bias) < 2 ? "почти без смещения" : acc.bias > 0 ? "ученики справились лучше прогноза" : "ученики справились хуже прогноза"}
      />
    </div>
  );
}

/** «+2,7» in green when the forecast came closer than the plain average, «−3,3» in red when it did worse. */
export function GainCell({ gain }: { gain: number | null }) {
  if (gain == null) return <>—</>;
  const r = Math.round(gain * 10) / 10;
  const tone = r > 0 ? "text-emerald-700" : r < 0 ? "text-red-700" : "text-arm-desc";
  return (
    <span className={tone} title={r > 0 ? "прогноз ближе к факту, чем простое среднее" : r < 0 ? "простое среднее ближе к факту" : "одинаково"}>
      {signedPoints(r)}
    </span>
  );
}

type CheckRow = { n: number; mae: number; naive: number; coverage: number };

/**
 * The method checked on synthetic classes (scripts/forecast-check.ts → forecast-check.json): the same code,
 * thousands of students of five profiles. Shown as is, the profiles where it is worse included.
 */
export function SyntheticCheck() {
  const profiles = Object.entries(check.profiles as Record<string, CheckRow>);
  const overall = check.overall as CheckRow;
  const better = profiles.filter(([, p]) => p.naive - p.mae >= 0.05).map(([k]) => k);
  const worse = profiles.filter(([, p]) => p.mae - p.naive >= 0.05).map(([k]) => k);
  return (
    <div className="rounded border border-arm-gray/70 p-3">
      <div className="text-sm font-semibold">Проверка метода на синтетических классах</div>
      <p className="mt-1 text-xs text-arm-desc">
        Тот же код прогноза на {overall.n.toLocaleString("ru-RU")} прогнозах: классы по 4–12 учеников, 3–9 занятий, пять профилей учеников, два способа
        моделировать шум. Ошибка — {points(overall.mae)} против {points(overall.naive)} у простого среднего, факт в интервале — в {overall.coverage} % случаев.
        {better.length > 0 && ` Точнее: ${better.join(", ")}.`}
        {worse.length > 0 && ` Хуже: ${worse.join(", ")}.`}
      </p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="text-left text-xs text-arm-desc">
            <tr className="border-b border-arm-gray/60">
              <th className="py-1 pr-3 font-medium">Профиль ученика</th>
              <th className="py-1 pr-3 text-right font-medium">Прогноз</th>
              <th className="py-1 pr-3 text-right font-medium">Простое среднее</th>
              <th className="py-1 pr-3 text-right font-medium">Разница</th>
              <th className="py-1 text-right font-medium">В интервале</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-arm-gray/50">
            {profiles.map(([name, p]) => (
              <tr key={name}>
                <td className="py-1 pr-3">{name}</td>
                <td className="py-1 pr-3 text-right tabular-nums">{num(p.mae)}</td>
                <td className="py-1 pr-3 text-right tabular-nums text-arm-desc">{num(p.naive)}</td>
                <td className="py-1 pr-3 text-right tabular-nums">
                  <GainCell gain={Math.round((p.naive - p.mae) * 10) / 10} />
                </td>
                <td className="py-1 text-right tabular-nums">{p.coverage} %</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
