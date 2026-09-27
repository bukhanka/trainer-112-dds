"use client";

import { fieldClass } from "@/components/ui";
import type { FormService } from "@/lib/lessons/options";

const PREFIX: [RegExp, string][] = [
  [/^Поселение\s+/, "поселение"],
  [/^Упр\.\s*района\s+/, "управа района"],
];

/** «Поселение Щукино» → «Щукино — поселение»: the part that tells 150 territorial services apart comes first. */
export function serviceLabel(shortName: string): string {
  for (const [re, kind] of PREFIX) if (re.test(shortName)) return `${shortName.replace(re, "")} — ${kind}`;
  return shortName;
}

const low = (s: string) => s.toLowerCase().replace(/ё/g, "е");

/** Services by kind, territorial ДДС first (the usual places of a lesson), each kind in the alphabet of its labels. */
export function serviceGroups(services: FormService[]): [string, FormService[]][] {
  const byKind = new Map<string, FormService[]>();
  for (const s of services) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s]);
  return [...byKind.entries()]
    .sort(([a], [b]) => Number(b.startsWith("территориал")) - Number(a.startsWith("территориал")))
    .map(([kind, list]) => [kind, [...list].sort((a, b) => serviceLabel(a.shortName).localeCompare(serviceLabel(b.shortName), "ru"))]);
}

/**
 * The ДДС service of a place. Typing letters on the open list jumps to the district; the search field of
 * the form (query) narrows every list to the matching services, the chosen one always stays.
 */
export function ServicePicker({
  services,
  value,
  query,
  onChange,
}: {
  services: FormService[];
  value: number | null;
  query: string;
  onChange: (id: number | null) => void;
}) {
  const q = low(query.trim());
  const shown = (s: FormService) => s.id === value || !q || low(s.shortName).includes(q) || low(s.fullName ?? "").includes(q);
  return (
    <select
      aria-label="Служба ДДС"
      className={`${fieldClass} h-8 w-full sm:w-56`}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
    >
      <option value="">— служба —</option>
      {serviceGroups(services).map(([kind, list]) => {
        const visible = list.filter(shown);
        if (!visible.length) return null;
        return (
          <optgroup key={kind} label={kind}>
            {visible.map((s) => (
              <option key={s.id} value={s.id} title={s.fullName ?? undefined}>
                {serviceLabel(s.shortName)}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
