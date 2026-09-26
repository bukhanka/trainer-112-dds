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
