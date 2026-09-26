import { sttConfigured, transcribe } from "@/lib/ai/provider";
import { apiUser } from "@/lib/auth/session";

const MAX_BYTES = 4 * 1024 * 1024; // ~1 minute of opus speech

/** Speech → text for phone calls. 204 when no STT server is configured: the browser then uses its own recogniser. */
export async function POST(request: Request) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  if (!sttConfigured()) return new Response(null, { status: 204 });

  const form = await request.formData();
  const audio = form.get("audio");
  if (!(audio instanceof Blob) || audio.size === 0) return Response.json({ error: "no audio" }, { status: 400 });
  if (audio.size > MAX_BYTES) return Response.json({ error: "audio too long" }, { status: 413 });

  try {
    const text = await transcribe(audio, audio instanceof File ? audio.name : "speech.webm");
    return Response.json({ text });
  } catch (err) {
    console.error("transcribe failed", err);
    return Response.json({ error: "stt failed" }, { status: 502 });
  }
}
