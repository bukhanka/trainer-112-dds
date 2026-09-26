/**
 * Plain HTML bar charts for reports: every bar has a label and a value with units, the scale starts
 * at zero and the axis shows its range. No chart library — the report must open offline and print.
 */
import type { ReactNode } from "react";

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

export function BarChart({ bars, max, unit, markerLabel, labelWidth = "11rem" }: { bars: Bar[]; max: number; unit: string; markerLabel?: string; labelWidth?: string }) {
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const cols = { gridTemplateColumns: `minmax(0,${labelWidth}) minmax(0,1fr) 5.5rem` };
  return (
    <figure className="flex flex-col gap-1.5 text-sm">
      {bars.map((b) => (
        <div key={b.key} className="grid items-center gap-2" style={cols} title={b.title}>
          <span className="truncate">{b.label}</span>
          <div className="relative h-4 rounded-sm bg-arm-panel">
            {b.value != null && <div className={`h-4 rounded-sm ${TONE[b.tone ?? "blue"]}`} style={{ width: pct(b.value) }} />}
            {b.marker != null && <div className="absolute -top-0.5 h-5 w-0.5 bg-arm-dark" style={{ left: pct(b.marker) }} aria-hidden />}
          </div>
          <span className="text-right tabular-nums">{b.valueLabel}</span>
        </div>
      ))}
      <figcaption className="grid gap-2 text-[11px] text-arm-desc" style={cols}>
        <span />
        <span className="flex justify-between">
          <span>0</span>
          <span>
            {Math.round(max / 2)} {unit}
          </span>
          <span>
            {max} {unit}
          </span>
        </span>
        <span />
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

/** Forecast against the fact per student on one 0–100 scale; the legend explains every mark. */
export function ForecastChart({ rows, labelWidth = "11rem", showFact = true }: { rows: ForecastRow[]; labelWidth?: string; showFact?: boolean }) {
  const cols = { gridTemplateColumns: `minmax(0,${labelWidth}) minmax(0,1fr) 8.5rem` };
  return (
    <figure className="flex flex-col gap-1.5 text-sm">
      {rows.map((r) => (
        <div key={r.key} className="grid items-center gap-2" style={cols} title={r.title}>
          <span className="truncate">{r.label}</span>
          <RangeBar low={r.low} high={r.high} expected={r.expected} fact={showFact ? r.fact : null} />
          <span className="text-right text-xs tabular-nums">{r.valueLabel}</span>
        </div>
      ))}
      <figcaption className="grid gap-2 text-[11px] text-arm-desc" style={cols}>
        <span />
        <span className="flex justify-between">
          <span>0</span>
          <span>50</span>
          <span>100 баллов</span>
        </span>
        <span />
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
