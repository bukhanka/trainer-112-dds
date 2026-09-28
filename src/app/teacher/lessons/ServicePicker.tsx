"use client";

import { fieldClass } from "@/components/ui";
import type { FormService } from "@/lib/lessons/options";

/** Okrug ДДС of the customer's list: «Поселение ЮЗАО» is the prefecture of the okrug, not a settlement. */
const PREFECTURE = /^Поселение\s+(ЦАО|САО|СВАО|ВАО|ЮВАО|ЮАО|ЮЗАО|ЗАО|СЗАО|ЗелАО|ТиНАО|ТАО|НАО)$/;

/**
 * What a territorial ДДС is: the customer's list names them all «Поселение …», the full name tells a district
 * («ДДС района Щукино»), a settlement of ТиНАО («ДДС поселения Вороновское»), a town («городского округа Троицк»)
 * and a prefecture apart.
 */
function territoryKind(shortName: string, fullName: string | null | undefined): string {
  const full = (fullName ?? "").toLowerCase();
  if (PREFECTURE.test(shortName) || full.includes("префектур")) return "префектура";
  if (full.includes("городского округа")) return "городской округ";
  if (full.includes("поселени")) return "поселение";
  return "район";
}

/** «Поселение Щукино» → «Щукино — район»: the part that tells 150 territorial services apart comes first. */
export function serviceLabel(shortName: string, fullName?: string | null): string {
  const territorial = /^Поселение\s+(.+)$/.exec(shortName);
  if (territorial) return `${territorial[1]} — ${territoryKind(shortName, fullName)}`;
  const council = /^Упр\.\s*района\s+(.+)$/.exec(shortName);
  if (council) return `${council[1]} — управа района`;
  return shortName;
}

const low = (s: string) => s.toLowerCase().replace(/ё/g, "е");

/** Services by kind, territorial ДДС first (the usual places of a lesson), each kind in the alphabet of its labels. */
export function serviceGroups(services: FormService[]): [string, FormService[]][] {
  const byKind = new Map<string, FormService[]>();
  for (const s of services) byKind.set(s.kind, [...(byKind.get(s.kind) ?? []), s]);
  return [...byKind.entries()]
    .sort(([a], [b]) => Number(b.startsWith("территориал")) - Number(a.startsWith("территориал")))
    .map(([kind, list]) => [kind, [...list].sort((a, b) => serviceLabel(a.shortName, a.fullName).localeCompare(serviceLabel(b.shortName, b.fullName), "ru"))]);
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
                {serviceLabel(s.shortName, s.fullName)}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}
