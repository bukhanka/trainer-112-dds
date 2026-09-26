import { z } from "zod";
import { speak } from "@/lib/ai/provider";
import { apiUser } from "@/lib/auth/session";

const body = z.object({ text: z.string().trim().min(1).max(1000), voice: z.enum(["male", "female"]).default("female") });

/** Text → speech (mp3). 204 when no TTS server is configured: the browser then speaks with its own voices. */
export async function POST(request: Request) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  if (!process.env.TTS_BASE_URL) return new Response(null, { status: 204 });

  const voiceName =
    parsed.data.voice === "male" ? process.env.TTS_VOICE_MALE || "male" : process.env.TTS_VOICE_FEMALE || "female";
  try {
    const audio = await speak(parsed.data.text, voiceName);
    if (!audio) return new Response(null, { status: 204 });
    return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("speak failed", err);
    return Response.json({ error: "tts failed" }, { status: 502 });
  }
}
