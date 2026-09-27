import { db } from "@/lib/db";
import { op112User } from "@/lib/op112/access";
import { searchKindsByLeaves } from "@/lib/op112/catalog";
import { leafTypes } from "@/lib/op112/panels";

let groupsCache: { at: number; list: { id: number; name: string }[] } | null = null;

// «Что случилось?»: the whole classifier behind the 51 kinds — a leaf or a group name with the typed words
// leads to its kind («судороги» → 103). The list of the workstation adds these to its own name and synonym hits.
export async function GET(req: Request) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 80);
  if (q.trim().length < 3) return Response.json({ kinds: [] });
  if (!groupsCache || Date.now() - groupsCache.at > 5 * 60_000) {
    groupsCache = { at: Date.now(), list: await db.incidentGroup.findMany({ select: { id: true, name: true } }) };
  }
  return Response.json({ kinds: searchKindsByLeaves(q, await leafTypes(), groupsCache.list) });
}
