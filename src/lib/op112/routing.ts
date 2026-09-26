/**
 * Service plates of a 112 card. The choice itself is made by the classifier engine
 * (src/lib/routing/engine.ts, see panels.ts); here are the pieces the workstation adds on top:
 * the operator's manual additions, which never remove a plate the system picked.
 */
import type { RoutedService } from "./types";

export type ServiceLite = {
  id: number;
  shortName: string;
  fullName?: string | null;
  kind: string;
  subtype?: string | null;
  okrug?: string | null;
  district?: string | null;
  orderIdx: number;
  delivery?: string;
};

/** Auto plates plus the operator's manual additions (auto plates cannot be removed). */
export function mergeManual(auto: RoutedService[], manualIds: number[], catalog: ServiceLite[]): RoutedService[] {
  const known = new Set(catalog.map((s) => s.id));
  const out = [...auto];
  for (const id of manualIds) {
    if (known.has(id) && !out.some((r) => r.serviceId === id)) out.push({ serviceId: id, isMain: false, auto: false });
  }
  return out;
}
