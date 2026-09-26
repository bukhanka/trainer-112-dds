/**
 * Model access. Every endpoint is a setting, not code: the demo stand points to a cloud API,
 * an isolated install points to local servers (Ollama / llama.cpp, faster-whisper, Piper) —
 * all of them speak the OpenAI-compatible HTTP format.
 *
 *   LLM_BASE_URL, LLM_API_KEY, LLM_MODEL    — /chat/completions
 *   STT_BASE_URL, STT_API_KEY, STT_MODEL    — /audio/transcriptions
 *   TTS_BASE_URL, TTS_API_KEY, TTS_MODEL    — /audio/speech
 *
 * Without LLM_BASE_URL the app runs in mock mode: deterministic answers, no network.
 */
import type { z } from "zod";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type Endpoint = { baseUrl: string; apiKey?: string; model: string };

function endpoint(prefix: "LLM" | "STT" | "TTS"): Endpoint | null {
  const baseUrl = process.env[`${prefix}_BASE_URL`];
  if (!baseUrl) return null;
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    apiKey: process.env[`${prefix}_API_KEY`] || undefined,
    model: process.env[`${prefix}_MODEL`] || "default",
  };
}

export function aiMode(): { llm: string; stt: string; tts: string } {
  const describe = (e: Endpoint | null) => (e ? `${e.model} @ ${new URL(e.baseUrl).host}` : "mock");
  return { llm: describe(endpoint("LLM")), stt: describe(endpoint("STT")), tts: describe(endpoint("TTS")) };
}

function authHeaders(e: Endpoint): Record<string, string> {
  return e.apiKey ? { Authorization: `Bearer ${e.apiKey}` } : {};
}

const TIMEOUT_MS = Number(process.env.AI_TIMEOUT_MS ?? 45_000);

export type ChatOptions = { temperature?: number; maxTokens?: number; json?: boolean; mock?: () => string };

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const e = endpoint("LLM");
  if (!e) return opts.mock ? opts.mock() : mockReply(messages);
  const res = await fetch(`${e.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(e) },
    body: JSON.stringify({
      model: e.model,
      messages,
      temperature: opts.temperature ?? 0.4,
      max_tokens: opts.maxTokens ?? 800,
      ...(opts.json ? { response_format: { type: "json_object" } } : {}),
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

/** Ask for JSON and validate it; one retry with the validation error shown to the model. */
export async function chatJson<T>(
  messages: ChatMessage[],
  schema: z.ZodType<T>,
  opts: Omit<ChatOptions, "json"> = {},
): Promise<T> {
  let history = messages;
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = await chat(history, { ...opts, json: true });
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

export async function transcribe(audio: Blob, fileName = "speech.webm"): Promise<string> {
  const e = endpoint("STT");
  if (!e) return "";
  const form = new FormData();
  form.append("file", audio, fileName);
  form.append("model", e.model);
  form.append("language", "ru");
  const res = await fetch(`${e.baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: authHeaders(e),
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`STT ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { text?: string };
  return data.text?.trim() ?? "";
}

/** Returns audio bytes (mp3) or null in mock mode — the UI then shows text only. */
export async function speak(text: string, voice: string): Promise<ArrayBuffer | null> {
  const e = endpoint("TTS");
  if (!e) return null;
  const res = await fetch(`${e.baseUrl}/audio/speech`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(e) },
    body: JSON.stringify({ model: e.model, input: text, voice, response_format: "mp3" }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.arrayBuffer();
}

function mockReply(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === "user")?.content ?? "";
  return last ? "Не знаю. Приезжайте быстрее, пожалуйста." : "Алло! Помогите!";
}
