"use client";

import Link from "next/link";
import { fieldClass } from "@/components/ui";
import type { Coverage } from "@/lib/lessons/coverage";
import { decodeLocation, encodeLocation, placeLabel, type LocationFilter, type LocationGroup } from "@/lib/scenarios/location";

/** Optional округ / район of the lesson: places without tasks then draw only scenarios that happen there. */
export function LocationField({
  value,
  locations,
  onChange,
}: {
  value: LocationFilter | null;
  locations: LocationGroup[];
  onChange: (value: { okrug: string; district: string | null } | null) => void;
}) {
  const current = encodeLocation(value);
  const known = locations.some((g) => encodeLocation({ okrug: g.okrug }) === current || g.districts.some((d) => encodeLocation({ okrug: g.okrug, district: d.name }) === current));
  return (
    <label className="flex flex-col gap-1 text-sm">
      Округ или район (необязательно)
      <select className={`${fieldClass} h-10 w-full sm:w-80`} value={current} onChange={(e) => onChange(decodeLocation(e.target.value))}>
        <option value="">любая</option>
        {current && !known && <option value={current}>{placeLabel(value)} — нет утверждённых сценариев</option>}
        {locations.map((g) => (
          <optgroup key={g.okrug} label={g.okrug === "МО" ? "Московская область" : g.okrug}>
            <option value={encodeLocation({ okrug: g.okrug })}>
              {g.okrug === "МО" ? "Московская область" : `${g.okrug} — весь округ`} · {g.count}
            </option>
            {g.districts.map((d) => (
              <option key={d.name} value={encodeLocation({ okrug: g.okrug, district: d.name })}>
                {d.name} · {d.count}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <span className="text-xs text-arm-desc">Места без заданий получат только сценарии этого округа или района. Число — сколько там утверждённых сценариев.</span>
    </label>
  );
}

/** The way out: drafts of the empty category to approve, or new drafts of it in the lesson's location. */
function WayOut({ category, location }: { category: string | undefined; location: LocationFilter | null }) {
  const q = category ? `&category=${encodeURIComponent(category)}` : "";
  const gen = new URLSearchParams({ ...(category ? { category } : {}), ...(location ? { loc: encodeLocation(location) } : {}) });
  return (
    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-medium">
      <Link href={`/teacher/scenarios?status=DRAFT${q}`} className="text-arm-blue underline">
        {category ? `Черновики «${category}» — на утверждение` : "Черновики в разделе «Сценарии» — на утверждение"}
      </Link>
      <Link href={`/teacher/scenarios/generate${gen.size ? `?${gen}` : ""}`} className="text-arm-blue underline">
        Сгенерировать сценарии по категории
      </Link>
    </div>
  );
}

/** Before the start: categories that give nothing, or a plain «так занятие не начнётся» with the way out. */
export function CoverageNotice({ coverage, warnings, location = null }: { coverage: Coverage; warnings: string[]; location?: LocationFilter | null }) {
  if (coverage.blocked) {
    return (
      <div role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
        <p className="font-medium">Занятие не начнётся с такими настройками.</p>
        <p className="mt-1">{coverage.blocked}</p>
        <WayOut category={coverage.empty[0]} location={location} />
      </div>
    );
  }
  if (!warnings.length) return null;
  return (
    <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
      <ul className="list-disc space-y-1 pl-5">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      <WayOut category={coverage.empty[0]} location={location} />
    </div>
  );
}
