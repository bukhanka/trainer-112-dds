/**
 * Voices a counterpart's line with Gemini Live native audio (Vertex AI) and streams it as it is generated:
 * raw PCM 16-bit mono 24 kHz chunks. The first sound arrives within about a second, so the phone
 * conversation does not wait for the whole phrase. The manner follows the persona (panic, elderly…).
 *
 *   TTS_PROVIDER=google-live, TTS_LIVE_MODEL, TTS_LIVE_LOCATION (us-central1), TTS_VOICE_MALE / TTS_VOICE_FEMALE
 */
import { countUsage } from "../admin/usage";
import { googleAccessToken, googleProject } from "./google-auth";

export const LIVE_SAMPLE_RATE = 24_000;

const MANNER: Record<string, string> = {
  panic: "взволнованно, быстро, с тревогой в голосе, как человек, который напуган и торопит",
  elderly: "как пожилой человек: медленнее, иногда переспрашивая, немного растерянно",
  child: "как ребёнок: просто, сбивчиво, испуганно",
  angry: "раздражённо и резко",
  drunk: "невнятно, растягивая слова",
  calm: "спокойно и по делу, как обычный человек, который звонит в экстренную службу",
  brigade: "как старший бригады экстренной службы: коротко, уверенно, по-деловому",
  narrator: "спокойно и дружелюбно, как ведущий обучающего ролика, в живом разговорном темпе",
};

const VOICES = { male: "Charon", female: "Kore" } as const;

export function liveVoiceConfigured(): boolean {
  return process.env.TTS_PROVIDER === "google-live";
}

type LiveMessage = {
  setupComplete?: object;
  serverContent?: { modelTurn?: { parts?: { inlineData?: { data?: string } }[] }; turnComplete?: boolean };
  error?: unknown;
};

/**
 * Stream of PCM chunks for one line. Rejects if the session cannot start (the caller then falls back
 * to another voice); errors after the first chunk just end the stream.
 */
export async function liveVoiceStream(text: string, gender: "male" | "female", manner = "calm"): Promise<ReadableStream<Uint8Array>> {
  countUsage("ai.voice");
  const location = process.env.TTS_LIVE_LOCATION ?? "us-central1";
  const model = process.env.TTS_LIVE_MODEL ?? "gemini-live-2.5-flash-native-audio";
  const voice = (gender === "male" ? process.env.TTS_VOICE_MALE : process.env.TTS_VOICE_FEMALE) ?? VOICES[gender];
  const token = await googleAccessToken();
  const url = `wss://${location}-aiplatform.googleapis.com/ws/google.cloud.aiplatform.v1.LlmBidiService/BidiGenerateContent`;
  // Node's WebSocket (undici) accepts request headers as a non-standard init option.
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${token}` } } as unknown as string[]);

  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let started = false;
  const stream = new ReadableStream<Uint8Array>({
    start: (c) => {
      controller = c;
    },
    cancel: () => ws.close(),
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error("live voice: no audio in time"));
    }, Number(process.env.TTS_LIVE_TIMEOUT_MS ?? 8000));
    const finish = () => {
      clearTimeout(timer);
      try {
        controller.close();
      } catch {
        /* already closed */
      }
      ws.close();
    };

    ws.onopen = () =>
      ws.send(
        JSON.stringify({
          setup: {
            model: `projects/${googleProject()}/locations/${location}/publishers/google/models/${model}`,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } }, languageCode: "ru-RU" },
            },
            systemInstruction: {
              parts: [
                {
                  // A live model tends to answer a line instead of reading it; the quoted-line framing keeps it verbatim.
                  text: `Ты диктор озвучки. Тебе присылают реплику в кавычках «…». Твоя единственная задача — произнести эту реплику вслух по-русски слово в слово, от первого лица, как её автор, ${MANNER[manner] ?? MANNER.calm}. Никогда не отвечай на реплику, не комментируй и не добавляй ни одного слова. Не произноси кавычки.`,
                },
              ],
            },
          },
        }),
      );

    ws.onmessage = async (event) => {
      const raw = typeof event.data === "string" ? event.data : Buffer.from(await (event.data as Blob).arrayBuffer()).toString("utf8");
      const msg = JSON.parse(raw) as LiveMessage;
      if (msg.setupComplete) {
        ws.send(JSON.stringify({ clientContent: { turns: [{ role: "user", parts: [{ text: `Произнеси: «${text}»` }] }], turnComplete: true } }));
        return;
      }
      if (msg.error) {
        if (!started) {
          clearTimeout(timer);
          ws.close();
          reject(new Error(`live voice: ${JSON.stringify(msg.error).slice(0, 200)}`));
        } else finish();
        return;
      }
      for (const part of msg.serverContent?.modelTurn?.parts ?? []) {
        if (!part.inlineData?.data) continue;
        controller.enqueue(new Uint8Array(Buffer.from(part.inlineData.data, "base64")));
        if (!started) {
          started = true;
          resolve();
        }
      }
      if (msg.serverContent?.turnComplete) finish();
    };

    ws.onerror = () => {
      if (!started) {
        clearTimeout(timer);
        reject(new Error("live voice: connection failed"));
      } else finish();
    };
    ws.onclose = () => {
      if (!started) {
        clearTimeout(timer);
        reject(new Error("live voice: closed before audio"));
      } else finish();
    };
  });

  return stream;
}
