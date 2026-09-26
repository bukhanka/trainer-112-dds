/** Service directory and the routing entry point used by the 112 API. */
import { db } from "@/lib/db";
import { mergeManual, routeServices, type RoutingInput, type ServiceLite } from "./routing";
import type { RoutedService } from "./types";

let cache: { at: number; list: ServiceLite[] } | null = null;

/** All services of the «Добавьте службы» window, in the customer's order. Cached for a minute. */
export async function serviceCatalog(): Promise<ServiceLite[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.list;
  const rows = await db.service.findMany({
    where: { visible: true },
    orderBy: { orderIdx: "asc" },
    select: { id: true, shortName: true, fullName: true, kind: true, subtype: true, okrug: true, district: true, orderIdx: true },
  });
  cache = { at: Date.now(), list: rows };
  return rows;
}

/** Plates chosen by the system for the card as filled so far. */
export async function autoServices(input: RoutingInput): Promise<RoutedService[]> {
  return routeServices(input, await serviceCatalog());
}

export async function finalServices(input: RoutingInput, manualIds: number[]): Promise<RoutedService[]> {
  const catalog = await serviceCatalog();
  return mergeManual(routeServices(input, catalog), manualIds, catalog);
}
