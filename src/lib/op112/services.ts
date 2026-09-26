/** Service directory for the 112 workstation. */
import { db } from "@/lib/db";
import type { ServiceLite } from "./routing";

let cache: { at: number; list: ServiceLite[] } | null = null;

/** Services of the «Добавьте службы» window (visible plates), sorted by the customer's list number. */
export async function serviceCatalog(): Promise<ServiceLite[]> {
  if (cache && Date.now() - cache.at < 60_000) return cache.list;
  const rows = await db.service.findMany({
    where: { visible: true },
    orderBy: { id: "asc" },
    select: { id: true, shortName: true, fullName: true, kind: true, subtype: true, okrug: true, district: true, orderIdx: true, delivery: true },
  });
  cache = { at: Date.now(), list: rows };
  return rows;
}
