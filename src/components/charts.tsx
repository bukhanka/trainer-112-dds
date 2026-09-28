/**
 * Plain HTML bar charts for reports: every bar has a label and a value with units, the scale starts
 * at zero and the axis shows its range. No chart library — the report must open offline and print.
 */
import type { CSSProperties, ReactNode } from "react";
import { countLabel } from "@/lib/format";

export type Bar = {
  key: string;
  label: ReactNode;
  value: number | null;
  valueLabel: ReactNode;
  tone?: "blue" | "red" | "amber" | "green" | "gray";
  /** Optional marker on the same scale, e.g. the norm. */
  marker?: number | null;
  title?: string;
};

const TONE = { blue: "bg-arm-blue", red: "bg-red-600", amber: "bg-amber-500", green: "bg-emerald-600", gray: "bg-arm-gray" };

/** On a phone the label and the value share a line and the bar goes under them, full width, as in ForecastChart. */
export function BarChart({ bars, max, unit, markerLabel, labelWidth = "11rem" }: { bars: Bar[]; max: number; unit: string; markerLabel?: string; labelWidth?: string }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const cols = { "--cols": `minmax(0,${labelWidth}) minmax(0,1fr) 5.5rem` } as CSSProperties;
  const grid = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 sm:[grid-template-columns:var(--cols)]";
  return (
    <figure className="flex flex-col gap-2 text-sm sm:gap-1.5">
      {bars.map((b) => (
        <div key={b.key} className={`${grid} gap-y-0.5`} style={cols} title={b.title}>
          <span className="truncate">{b.label}</span>
          <span className="text-right tabular-nums sm:order-3">{b.valueLabel}</span>
          <div className="relative col-span-2 h-4 rounded-sm bg-arm-panel sm:order-2 sm:col-span-1">
            {b.value != null && <div className={`h-4 rounded-sm ${TONE[b.tone ?? "blue"]}`} style={{ width: pct(b.value) }} />}
            {b.marker != null && <div className="absolute -top-0.5 h-5 w-0.5 bg-arm-dark" style={{ left: pct(b.marker) }} aria-hidden />}
          </div>
        </div>
      ))}
      <figcaption className={`${grid} text-[11px] text-arm-desc`} style={cols}>
        <span className="hidden sm:block" />
        <span className="col-span-2 flex justify-between sm:col-span-1">
          <span>0</span>
          <span>
            {Math.round(max / 2)} {unit}
          </span>
          <span>
            {max} {unit}
          </span>
        </span>
        <span className="hidden sm:block" />
      </figcaption>
      {markerLabel && (
        <p className="text-[11px] text-arm-desc">
          <span className="mr-1 inline-block h-3 w-0.5 bg-arm-dark align-middle" /> {markerLabel}
        </p>
      )}
    </figure>
  );
}

/** Rounded-up axis maximum: 47 → 50, 180 → 200. */
export function niceMax(value: number, minimum = 10): number {
  const v = Math.max(value, minimum);
  const step = v <= 50 ? 10 : v <= 200 ? 20 : v <= 600 ? 60 : 300;
  return Math.ceil(v / step) * step;
}

const pct100 = (v: number) => `${Math.max(0, Math.min(100, v))}%`;

/**
 * A 0–100 score scale with the forecast interval (band), the forecast (line) and, when known, the
 * fact (dot: green inside the interval, red outside).
 */
export function RangeBar({ low, high, expected, fact }: { low: number; high: number; expected: number; fact?: number | null }) {
  const inside = fact != null && fact >= low && fact <= high;
  const label = `прогноз ${Math.round(expected)}, интервал ${Math.round(low)}–${Math.round(high)}${fact != null ? `, факт ${Math.round(fact)}` : ""} из 100`;
  return (
    <div className="relative h-4 rounded-sm bg-arm-panel" role="img" aria-label={label} title={label}>
      <div className="absolute inset-y-0 rounded-sm bg-arm-blue/25" style={{ left: pct100(low), width: pct100(high - low) }} />
      <div className="absolute -top-0.5 h-5 w-0.5 -translate-x-1/2 bg-arm-blue" style={{ left: pct100(expected) }} />
      {fact != null && (
        <div
          className={`absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white ${inside ? "bg-emerald-600" : "bg-red-600"}`}
          style={{ left: pct100(fact) }}
        />
      )}
    </div>
  );
}

export type ForecastRow = { key: string; label: ReactNode; low: number; high: number; expected: number; fact: number | null; valueLabel: ReactNode; title?: string };

/**
 * Forecast against the fact per student on one 0–100 scale; the legend explains every mark. On a phone
 * the name and the numbers go on one line and the scale under them, full width.
 */
export function ForecastChart({ rows, labelWidth = "11rem", showFact = true }: { rows: ForecastRow[]; labelWidth?: string; showFact?: boolean }) {
  const cols = { "--cols": `minmax(0,${labelWidth}) minmax(0,1fr) 8.5rem` } as CSSProperties;
  const grid = "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 sm:[grid-template-columns:var(--cols)]";
  return (
    <figure className="flex flex-col gap-2 text-sm sm:gap-1.5">
      {rows.map((r) => (
        <div key={r.key} className={`${grid} gap-y-0.5`} style={cols} title={r.title}>
          <span className="truncate">{r.label}</span>
          <span className="text-right text-xs tabular-nums sm:order-3">{r.valueLabel}</span>
          <div className="col-span-2 sm:order-2 sm:col-span-1">
            <RangeBar low={r.low} high={r.high} expected={r.expected} fact={showFact ? r.fact : null} />
          </div>
        </div>
      ))}
      <figcaption className={`${grid} text-[11px] text-arm-desc`} style={cols}>
        <span className="hidden sm:block" />
        <span className="col-span-2 flex justify-between sm:col-span-1">
          <span>0</span>
          <span>50</span>
          <span>100 баллов</span>
        </span>
        <span className="hidden sm:block" />
      </figcaption>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-arm-desc">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-6 rounded-sm bg-arm-blue/25" /> интервал прогноза (рассчитан так, чтобы факт попадал в него 8 раз из 10)
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-3 w-0.5 bg-arm-blue" /> прогноз
        </span>
        {showFact && (
          <>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-600" /> факт в интервале
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-600" /> факт вне интервала
            </span>
          </>
        )}
      </p>
    </figure>
  );
}

export type ScatterPoint = { key: string; x: number; y: number; inside: boolean; title: string };

/**
 * Forecast (x) against the fact (y), both on 0–100 from zero. Points on the dashed diagonal are exact
 * forecasts; above it the student did better than forecast, below — worse.
 */
export function ForecastScatter({ points }: { points: ScatterPoint[] }) {
  const L = 46;
  const T = 10;
  const W = 260;
  const H = 260;
  const x = (v: number) => L + (Math.max(0, Math.min(100, v)) / 100) * W;
  const y = (v: number) => T + H - (Math.max(0, Math.min(100, v)) / 100) * H;
  const ticks = [0, 25, 50, 75, 100];
  return (
    <figure className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${L + W + 14} ${T + H + 44}`} className="w-full max-w-md" role="img" aria-label={`Прогноз и факт: ${countLabel(points.length, ["ученик-занятие", "ученика-занятия", "учеников-занятий"])}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={T} y2={T + H} className="stroke-arm-gray/60" strokeWidth={1} />
            <line x1={L} x2={L + W} y1={y(t)} y2={y(t)} className="stroke-arm-gray/60" strokeWidth={1} />
            <text x={x(t)} y={T + H + 16} textAnchor="middle" className="fill-arm-desc text-[11px]">
              {t}
            </text>
            <text x={L - 6} y={y(t) + 4} textAnchor="end" className="fill-arm-desc text-[11px]">
              {t}
            </text>
          </g>
        ))}
        <line x1={x(0)} y1={y(0)} x2={x(100)} y2={y(100)} className="stroke-arm-dark" strokeWidth={1.2} strokeDasharray="5 4" />
        <text x={x(12)} y={y(12) - 4} transform={`rotate(-45 ${x(12)} ${y(12) - 4})`} className="fill-arm-desc text-[10px]">
          прогноз = факт
        </text>
        {points.map((p) => (
          <circle key={p.key} cx={x(p.x)} cy={y(p.y)} r={5} className={`${p.inside ? "fill-emerald-600" : "fill-red-600"} stroke-white`} strokeWidth={1.5} fillOpacity={0.85}>
            <title>{p.title}</title>
          </circle>
        ))}
        <text x={L + W / 2} y={T + H + 36} textAnchor="middle" className="fill-arm-dark text-[12px]">
          прогноз на старте занятия, баллы
        </text>
        <text x={12} y={T + H / 2} textAnchor="middle" transform={`rotate(-90 12 ${T + H / 2})`} className="fill-arm-dark text-[12px]">
          факт — средний подтверждённый балл
        </text>
      </svg>
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-arm-desc">
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-emerald-600" /> факт в интервале прогноза
        </span>
        <span className="inline-flex items-center gap-1">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-red-600" /> вне интервала
        </span>
        <span>выше диагонали — справился лучше прогноза, ниже — хуже</span>
      </figcaption>
    </figure>
  );
}

export type ColumnSeries = { name: string; tone: keyof typeof TONE; values: number[] };

/**
 * Days side by side, a thin column per series (e.g. lessons started and finished). The scale starts at zero,
 * the axis shows its range, every day tells its exact values on hover; the exact numbers also go in a table
 * next to the chart. For the administrator's usage statistics.
 */
export function DailyColumns({ days, series, label }: { days: { key: string; label: string; title: string }[]; series: ColumnSeries[]; label: string }) {
  const top = Math.max(0, ...series.flatMap((s) => s.values));
  // Small counts get a small even axis (0–2, 0–4, 0–6), so one lesson a day is not a sliver.
  const max = top <= 6 ? Math.max(2, Math.ceil(top / 2) * 2) : niceMax(top, 10);
  const height = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const summary = series.map((s) => `${s.name}: всего ${s.values.reduce((a, b) => a + b, 0)}`).join(", ");
  return (
    <figure className="flex flex-col gap-1 text-sm" role="img" aria-label={`${label} по дням. ${summary}`}>
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-1">
        <div className="flex h-28 flex-col justify-between text-right text-[11px] leading-none tabular-nums text-arm-desc" aria-hidden>
          <span>{max}</span>
          <span>{max / 2}</span>
          <span>0</span>
        </div>
        <div className="relative flex h-28 items-end gap-[2px] border-b border-l border-arm-gray">
          <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-arm-gray/70" aria-hidden />
          {days.map((d, i) => (
            <div key={d.key} className="relative flex h-full min-w-0 flex-1 items-end justify-center gap-px" title={`${d.title}: ${series.map((s) => `${s.name.toLowerCase()} ${s.values[i] ?? 0}`).join(", ")}`}>
              {series.map((s) => (
                <div key={s.name} className={`w-full max-w-2.5 rounded-t-sm ${TONE[s.tone]}`} style={{ height: height(s.values[i] ?? 0) }} />
              ))}
            </div>
          ))}
        </div>
        <span />
        <div className="flex gap-[2px] pt-0.5 text-[10px] text-arm-desc" aria-hidden>
          {days.map((d) => (
            <span key={d.key} className="min-w-0 flex-1 overflow-hidden text-center">
              {d.label}
            </span>
          ))}
        </div>
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-arm-desc">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1">
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${TONE[s.tone]}`} /> {s.name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
