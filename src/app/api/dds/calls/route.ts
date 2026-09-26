import { z } from "zod";
import { badRequest, ddsContext } from "@/lib/dds/api";
import { dial } from "@/lib/dds/calls";

const bodySchema = z.object({ number: z.string().min(1).max(40), incidentId: z.string().max(40).nullish() });

/** Outgoing call: a crew, the applicant, another service of the card or an organisation from the book. */
export async function POST(request: Request) {
  const ctx = await ddsContext(request, { write: true });
  if (ctx instanceof Response) return ctx;
  const body = bodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return badRequest("Наберите номер");
  const res = await dial(ctx.access.seat, body.data.number, body.data.incidentId);
  if (!res.ok) return Response.json({ error: "call_failed", message: res.error }, { status: res.code });
  return Response.json(res.call);
}
