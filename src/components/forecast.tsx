/** Pieces of «прогноз ↔ факт» shared by the lesson report and «Отчёты». */
import { Stat } from "@/components/ui";
import type { Accuracy } from "@/lib/adaptive/forecast";
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

/** Four numbers of forecast accuracy, shared by the lesson report and «Отчёты». */
export function AccuracyStats({ acc, what }: { acc: Accuracy; what: [string, string, string] }) {
  const better = acc.mae != null && acc.baselineMae != null ? Math.round((acc.baselineMae - acc.mae) * 10) / 10 : null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Stat label="Ошибка прогноза (средняя абсолютная)" value={acc.mae == null ? "—" : points(acc.mae)} hint={acc.n ? `сравнено: ${countLabel(acc.n, what)}` : "факта ещё нет"} />
      <Stat label="Факт в интервале прогноза" value={acc.n ? `${acc.inside} из ${acc.n}` : "—"} hint="интервал рассчитан на 8 из 10" />
      <Stat
        label="Ошибка простого среднего прошлых занятий"
        value={acc.baselineMae == null ? "—" : points(acc.baselineMae)}
        hint={better == null ? "наивный прогноз без тренда — для сравнения" : better > 0 ? `прогноз с трендом точнее на ${points(better)}` : better < 0 ? `прогноз с трендом хуже на ${points(-better)}` : "точность одинаковая"}
      />
      <Stat
        label="Смещение: факт − прогноз"
        value={acc.bias == null ? "—" : signedPoints(acc.bias)}
        hint={acc.bias == null ? undefined : Math.abs(acc.bias) < 2 ? "почти без смещения" : acc.bias > 0 ? "ученики справились лучше прогноза" : "ученики справились хуже прогноза"}
      />
    </div>
  );
}

