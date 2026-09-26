import { z } from "zod";
import { speak, ttsConfigured } from "@/lib/ai/provider";
import { LIVE_SAMPLE_RATE, liveVoiceConfigured, liveVoiceStream } from "@/lib/ai/live-voice";
import { apiUser } from "@/lib/auth/session";

const body = z.object({
  text: z.string().trim().min(1).max(1000),
  voice: z.enum(["male", "female"]).default("female"),
  manner: z.enum(["calm", "panic", "elderly", "child", "angry", "drunk", "brigade"]).default("calm"),
});

/**
 * Counterpart's line as speech. Gemini Live voice streams raw PCM (audio/pcm) as it is generated; the fallback
 * and other providers return mp3. 204 when no speech service is configured: the browser speaks itself.
 */
export async function POST(request: Request) {
  const user = await apiUser();
  if (user instanceof Response) return user;
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad request" }, { status: 400 });
  if (!ttsConfigured()) return new Response(null, { status: 204 });
  const { text, voice, manner } = parsed.data;

  if (liveVoiceConfigured()) {
    try {
      const stream = await liveVoiceStream(text, voice, manner);
      return new Response(stream, { headers: { "Content-Type": `audio/pcm;rate=${LIVE_SAMPLE_RATE}`, "Cache-Control": "no-store" } });
    } catch (err) {
      console.error("live voice failed, falling back", err);
    }
  }
  try {
    const audio = await speak(text, voice);
    if (!audio) return new Response(null, { status: 204 });
    return new Response(audio, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("speak failed", err);
    return Response.json({ error: "tts failed" }, { status: 502 });
  }
}
