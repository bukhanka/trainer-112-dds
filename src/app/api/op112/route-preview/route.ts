import { jsonError, op112User, readJson } from "@/lib/op112/access";
import { draftSchema } from "@/lib/op112/draft";
import { resolveDraft, routeDraft, typeNames } from "@/lib/op112/panels";

const bodySchema = draftSchema.pick({ cards: true, answers: true, flags: true, address: true });

// Plates the system picks for the card as filled so far, and the «Класс.» it resolves to.
export async function POST(req: Request) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const body = bodySchema.safeParse(await readJson(req));
  if (!body.success) return jsonError("bad_request", 400);
  const resolved = await resolveDraft(body.data);
  const names = await typeNames(resolved.typeCodes);
  return Response.json({
    services: await routeDraft(body.data, resolved),
    classes: resolved.typeCodes.map((c) => names[c]).filter(Boolean),
  });
}
