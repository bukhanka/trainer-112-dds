/**
 * Model access. Every endpoint is a setting, not code: the demo stand points to a cloud API, an isolated
 * install points to local servers (Ollama / llama.cpp, faster-whisper, Piper) — the chat part always
 * speaks the OpenAI-compatible HTTP format.
 *
 *   LLM_BASE_URL, LLM_MODEL, LLM_MODEL_SMART   — /chat/completions; LLM_MODEL_SMART (optional) for grading
 *   LLM_API_KEY or LLM_AUTH=google              — static key, or a Google service-account token (Vertex AI)
 *   LLM_REASONING=low, LLM_REASONING_TOKENS     — for reasoning models: effort and extra token budget
 *   STT_PROVIDER=openai|google, STT_BASE_URL, STT_API_KEY, STT_MODEL, STT_LOCATION
 *   TTS_PROVIDER=openai|google, TTS_BASE_URL, TTS_API_KEY, TTS_MODEL, TTS_VOICE_MALE, TTS_VOICE_FEMALE
 *   AI_MAX_CALLS_PER_MIN                        — budget guard for a public stand
 *
 * Without LLM_BASE_URL the app runs in mock mode: deterministic answers, no network.
 */
import type { z } from "zod";
import { googleAccessToken, googleCredentialsConfigured, googleProject } from "./google-auth";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** fast — a counterpart on the phone (short, quick); smart — grading, reading free text, drafts. */
export type ModelTier = "fast" | "smart";

export type ChatOptions = {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
  tier?: ModelTier;
  mock?: () => string;
};

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 45_000);
const env = (name: string) => process.env[name] || undefined;

// ─── configuration ───────────────────────────────────────────────────────────

export function llmConfigured(): boolean {
  return Boolean(env("LLM_BASE_URL"));
}

function sttProvider(): "google" | "openai" | null {
  if (env("STT_PROVIDER") === "google") return googleCredentialsConfigured() ? "google" : null;
  return env("STT_BASE_URL") ? "openai" : null;
}

/** google-live streams Gemini Live voice (src/lib/ai/live-voice.ts); its mp3 fallback is Google Text-to-Speech. */
function ttsProvider(): "google" | "openai" | null {
  const provider = env("TTS_PROVIDER");
  if (provider === "google" || provider === "google-live") return googleCredentialsConfigured() ? "google" : null;
  return env("TTS_BASE_URL") ? "openai" : null;
}

export function sttConfigured(): boolean {
  return sttProvider() !== null;
}

export function ttsConfigured(): boolean {
  return ttsProvider() !== null;
}

function modelFor(tier: ModelTier): string {
  return (tier === "smart" ? env("LLM_MODEL_SMART") : undefined) ?? env("LLM_MODEL") ?? "default";
}

/** What is connected, for the admin page. No secrets. */
export function aiMode(): { llm: string; stt: string; tts: string } {
  const host = (url?: string) => {
    try {
      return url ? new URL(url).host : "";
    } catch {
      return "";
    }
  };
  const llm = llmConfigured()
    ? `${modelFor("fast")}${env("LLM_MODEL_SMART") ? ` / ${env("LLM_MODEL_SMART")}` : ""} @ ${host(env("LLM_BASE_URL"))}`
    : "mock";
  const stt = sttProvider() === "google" ? `${env("STT_MODEL") ?? "chirp_3"} @ Google Speech-to-Text` : sttProvider() ? `${env("STT_MODEL") ?? "default"} @ ${host(env("STT_BASE_URL"))}` : "mock";
  const tts =
    env("TTS_PROVIDER") === "google-live" && ttsProvider()
      ? `${env("TTS_LIVE_MODEL") ?? "gemini-live-2.5-flash-native-audio"} (запасной — Google Text-to-Speech)`
      : ttsProvider() === "google"
        ? "Google Text-to-Speech"
        : ttsProvider()
          ? `${env("TTS_MODEL") ?? "default"} @ ${host(env("TTS_BASE_URL"))}`
          : "mock";
  return { llm, stt, tts };
}

async function llmAuthHeaders(): Promise<Record<string, string>> {
  if (env("LLM_AUTH") === "google") return { Authorization: `Bearer ${await googleAccessToken()}` };
  const key = env("LLM_API_KEY");
  return key ? { Authorization: `Bearer ${key}` } : {};
}

// ─── budget guard ────────────────────────────────────────────────────────────

const CALLS_PER_MIN = Number(process.env.AI_MAX_CALLS_PER_MIN ?? 300);
const windows: Record<"chat" | "voice", { start: number; calls: number }> = {
  chat: { start: 0, calls: 0 },
  voice: { start: 0, calls: 0 },
};

/** Paid calls per minute for this process (chat and speech counted apart); above the limit callers fall back. */
export function takeCall(kind: "chat" | "voice" = "chat"): boolean {
  const now = Date.now();
  const w = windows[kind];
  if (now - w.start > 60_000) {
    w.start = now;
    w.calls = 0;
  }
  w.calls += 1;
  return w.calls <= CALLS_PER_MIN;
}

// ─── chat ────────────────────────────────────────────────────────────────────

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  if (!llmConfigured()) return opts.mock ? opts.mock() : mockReply(messages);
  if (!takeCall()) throw new Error("AI call limit reached");
  const tier = opts.tier ?? "fast";
  const reasoning = env("LLM_REASONING");
  const res = await fetch(`${env("LLM_BASE_URL")!.replace(/\/+$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await llmAuthHeaders()) },
    body: JSON.stringify({
      model: modelFor(tier),
      messages,
      temperature: opts.temperature ?? 0.4,
      // Reasoning models spend part of max_tokens on thinking; the extra budget keeps the answer whole.
      max_tokens: (opts.maxTokens ?? 800) + (reasoning ? Number(env("LLM_REASONING_TOKENS") ?? 1024) : 0),
      ...(reasoning ? { reasoning_effort: reasoning } : {}),
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/** Ask for JSON and validate it; one retry with the validation error shown to the model. Smart tier by default. */
export async function chatJson<T>(messages: ChatMessage[], schema: z.ZodType<T>, opts: Omit<ChatOptions, "json"> = {}): Promise<T> {
  const options = { tier: "smart" as ModelTier, ...opts, json: true };
  let history = messages;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chat(history, options);
    const parsed = schema.safeParse(safeJson(raw));
    if (parsed.success) return parsed.data;
    history = [
      ...messages,
      { role: "assistant", content: raw },
      { role: "user", content: `Ответ не прошёл проверку: ${parsed.error.message.slice(0, 500)}. Верни только исправленный JSON.` },
    ];
  }
  throw new Error("LLM returned invalid JSON twice");
}

function safeJson(raw: string): unknown {
  const text = raw.replace(/^```(?:json)?\s*|\s*```$/g, "");
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// ─── speech to text ──────────────────────────────────────────────────────────

export async function transcribe(audio: Blob, fileName = "speech.webm"): Promise<string> {
  const provider = sttProvider();
  if (!provider) return "";
  if (!takeCall("voice")) throw new Error("AI call limit reached");
  if (provider === "google") return transcribeGoogle(audio);
  const form = new FormData();
  form.append("file", audio, fileName);
  form.append("model", env("STT_MODEL") ?? "default");
  form.append("language", "ru");
  const key = env("STT_API_KEY");
  const res = await fetch(`${env("STT_BASE_URL")!.replace(/\/+$/, "")}/audio/transcriptions`, {
    method: "POST",
    headers: key ? { Authorization: `Bearer ${key}` } : {},
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`STT ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { text?: string };
  return data.text?.trim() ?? "";
}

/** Google Speech-to-Text v2; the browser's webm/opus is decoded by the service. */
async function transcribeGoogle(audio: Blob): Promise<string> {
  const location = env("STT_LOCATION") ?? "us";
  const host = location === "global" ? "speech.googleapis.com" : `${location}-speech.googleapis.com`;
  const res = await fetch(`https://${host}/v2/projects/${googleProject()}/locations/${location}/recognizers/_:recognize`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await googleAccessToken()}` },
    body: JSON.stringify({
      config: { autoDecodingConfig: {}, languageCodes: ["ru-RU"], model: env("STT_MODEL") ?? "chirp_3" },
      content: Buffer.from(await audio.arrayBuffer()).toString("base64"),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`STT ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { results?: { alternatives?: { transcript?: string }[] }[] };
  return (data.results ?? [])
    .map((r) => r.alternatives?.[0]?.transcript ?? "")
    .join(" ")
    .trim();
}

// ─── text to speech ──────────────────────────────────────────────────────────

const GOOGLE_VOICES = { male: "ru-RU-Chirp3-HD-Charon", female: "ru-RU-Chirp3-HD-Kore" } as const;

/** mp3 bytes, or null when no speech service is configured (the browser then speaks itself). */
export async function speak(text: string, gender: "male" | "female"): Promise<ArrayBuffer | null> {
  const provider = ttsProvider();
  if (!provider) return null;
  if (!takeCall("voice")) return null; // the browser speaks with its own voices
  // With google-live the male/female voice names belong to Live; the Text-to-Speech fallback keeps its own.
  const named = env("TTS_PROVIDER") === "google-live" ? undefined : gender === "male" ? env("TTS_VOICE_MALE") : env("TTS_VOICE_FEMALE");
  const voice = named ?? (provider === "google" ? GOOGLE_VOICES[gender] : gender);
  if (provider === "google") {
    const res = await fetch("https://texttospeech.googleapis.com/v1/text:synthesize", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${await googleAccessToken()}`, "x-goog-user-project": googleProject() },
      body: JSON.stringify({ input: { text }, voice: { languageCode: "ru-RU", name: voice }, audioConfig: { audioEncoding: "MP3" } }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = (await res.json()) as { audioContent?: string };
    if (!data.audioContent) return null;
    const bytes = Buffer.from(data.audioContent, "base64");
    return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  }
  const key = env("TTS_API_KEY");
  const res = await fetch(`${env("TTS_BASE_URL")!.replace(/\/+$/, "")}/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ model: env("TTS_MODEL") ?? "default", input: text, voice, response_format: "mp3" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.arrayBuffer();
}

function mockReply(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  return last ? "Не знаю. Приезжайте быстрее, пожалуйста." : "Алло! Помогите!";
}
