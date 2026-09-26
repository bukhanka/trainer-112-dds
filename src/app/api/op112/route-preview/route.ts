import { jsonError, op112User, readJson } from "@/lib/op112/access";
import { deriveFlags } from "@/lib/op112/card";
import { draftSchema } from "@/lib/op112/draft";
import { autoServices } from "@/lib/op112/services";

const bodySchema = draftSchema.pick({ cards: true, answers: true, flags: true, address: true });

// Plates the system picks for the card as filled so far; the workstation calls it on every change.
export async function POST(req: Request) {
  const user = await op112User();
  if (user instanceof Response) return user;
  const body = bodySchema.safeParse(await readJson(req));
  if (!body.success) return jsonError("bad_request", 400);
  const d = body.data;
  const flags = deriveFlags(d.flags, d.cards, d.answers);
  return Response.json({ services: await autoServices({ cards: d.cards, answers: d.answers, flags, address: d.address }) });
}

