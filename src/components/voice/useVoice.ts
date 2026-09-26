"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Phone voice for the workstations.
 *  listen() / stop(): push-to-talk. With an STT server configured, records with MediaRecorder and sends the
 *                     clip to /api/voice/transcribe; otherwise uses the browser's own recogniser (Chrome,
 *                     Яндекс.Браузер). Resolves with the recognised text.
 *  say():             speaks a counterpart line via /api/voice/speak — a streamed voice (raw PCM, played as it
 *                     arrives) or an mp3; without a speech service uses the browser's own Russian voices.
 * The microphone needs HTTPS (or localhost).
 */

type RecognitionLike = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
};

export type VoiceState = "idle" | "listening" | "thinking" | "speaking";
export type VoiceGender = "male" | "female";
type Caps = { stt: boolean; tts: boolean; browserStt: boolean };

function createRecognition(): RecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => RecognitionLike; webkitSpeechRecognition?: new () => RecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const r = new Ctor();
  r.lang = "ru-RU";
  r.interimResults = false;
  r.maxAlternatives = 1;
  return r;
}

function pickVoice(gender: VoiceGender): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith("ru"));
  const pattern = gender === "male" ? /pavel|dmitr|yuri|maxim|male|муж/i : /irina|svetlana|milena|ekaterina|alena|female|жен/i;
  return voices.find((v) => pattern.test(v.name)) ?? voices[0];
}

export function useVoice() {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [caps, setCaps] = useState<Caps | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const recognition = useRef<RecognitionLike | null>(null);
  const resolveText = useRef<((text: string) => void) | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const audioCtx = useRef<AudioContext | null>(null);
  const sources = useRef<AudioBufferSourceNode[]>([]);
  const streamReader = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  useEffect(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.getVoices(); // Chrome loads voices lazily
    const browserStt = !!createRecognition();
    fetch("/api/voice/capabilities")
      .then((r) => (r.ok ? r.json() : { stt: false, tts: false }))
      .then((c: { stt: boolean; tts: boolean }) => setCaps({ ...c, browserStt }))
      .catch(() => setCaps({ stt: false, tts: false, browserStt }));
    return () => {
      recorder.current?.stream.getTracks().forEach((t) => t.stop());
      recognition.current?.stop();
      player.current?.pause();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  const finish = useCallback((text: string) => {
    setState("idle");
    resolveText.current?.(text.trim());
    resolveText.current = null;
  }, []);

  const listen = useCallback(async (): Promise<string> => {
    setError(null);
    player.current?.pause();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    const result = new Promise<string>((resolve) => (resolveText.current = resolve));

    if (caps?.stt) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        const rec = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        rec.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data);
        };
        rec.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          setState("thinking");
          const form = new FormData();
          form.append("audio", new Blob(chunks, { type: rec.mimeType || "audio/webm" }), "speech.webm");
          const res = await fetch("/api/voice/transcribe", { method: "POST", body: form }).catch(() => null);
          if (res?.ok && res.status === 200) finish(((await res.json()) as { text: string }).text);
          else {
            setError("Не удалось распознать речь — повторите или введите текстом");
            finish("");
          }
        };
        recorder.current = rec;
        rec.start();
        setState("listening");
      } catch {
        setError("Нет доступа к микрофону. Разрешите микрофон в браузере (нужен HTTPS).");
        finish("");
      }
      return result;
    }

    const r = caps?.browserStt ? createRecognition() : null;
    if (!r) {
      setError("Распознавание речи недоступно — введите реплику текстом");
      finish("");
      return result;
    }
    let text = "";
    r.onresult = (e) => {
      text = e.results[0]?.[0]?.transcript ?? "";
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed") setError("Нет доступа к микрофону. Разрешите микрофон в браузере (нужен HTTPS).");
    };
    r.onend = () => finish(text);
    recognition.current = r;
    r.start();
    setState("listening");
    return result;
  }, [caps, finish]);

  const stop = useCallback(() => {
    if (recorder.current?.state === "recording") recorder.current.stop();
    recognition.current?.stop();
    recognition.current = null;
  }, []);

  const say = useCallback(
    async (text: string, gender: VoiceGender = "female", manner = "calm") => {
      if (!text) return;
      setState("speaking");
      try {
        if (caps?.tts) {
          const res = await fetch("/api/voice/speak", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text, voice: gender, manner }),
          });
          const type = res.headers.get("content-type") ?? "";
          if (res.status === 200 && type.startsWith("audio/pcm") && res.body) {
            await playPcmStream(res.body, Number(/rate=(\d+)/.exec(type)?.[1] ?? 24000));
            return;
          }
          if (res.status === 200) {
            const url = URL.createObjectURL(await res.blob());
            const el = new Audio(url);
            player.current = el;
            await new Promise<void>((resolve) => {
              el.onended = () => resolve();
              el.onerror = () => resolve();
              void el.play().catch(() => resolve());
            });
            URL.revokeObjectURL(url);
            return;
          }
        }
        if ("speechSynthesis" in window) {
          await new Promise<void>((resolve) => {
            const u = new SpeechSynthesisUtterance(text);
            u.lang = "ru-RU";
            u.voice = pickVoice(gender) ?? null;
            u.rate = 1.05;
            u.onend = () => resolve();
            u.onerror = () => resolve();
            window.speechSynthesis.speak(u);
          });
        }
      } finally {
        setState("idle");
      }
    },
    [caps],
  );

  /** Plays 16-bit mono PCM as it arrives: the first words sound while the rest is still generated. */
  async function playPcmStream(body: ReadableStream<Uint8Array>, rate: number) {
    const ctx = (audioCtx.current ??= new AudioContext());
    await ctx.resume().catch(() => undefined);
    const reader = body.getReader();
    streamReader.current = reader;
    let playhead = ctx.currentTime + 0.05;
    let carry = new Uint8Array(0);
    for (;;) {
      const { value, done } = await reader.read().catch(() => ({ value: undefined, done: true as const }));
      if (done || !value) break;
      const bytes = new Uint8Array(carry.length + value.length);
      bytes.set(carry);
      bytes.set(value, carry.length);
      const even = bytes.length - (bytes.length % 2);
      carry = bytes.slice(even);
      if (!even) continue;
      const view = new DataView(bytes.buffer, 0, even);
      const samples = new Float32Array(even / 2);
      for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
      const buffer = ctx.createBuffer(1, samples.length, rate);
      buffer.copyToChannel(samples, 0);
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      playhead = Math.max(playhead, ctx.currentTime + 0.02);
      source.start(playhead);
      playhead += buffer.duration;
      sources.current.push(source);
    }
    streamReader.current = null;
    const left = playhead - ctx.currentTime;
    if (left > 0) await new Promise((r) => setTimeout(r, left * 1000));
    sources.current = [];
  }

  const cancel = useCallback(() => {
    stop();
    player.current?.pause();
    void streamReader.current?.cancel().catch(() => undefined);
    for (const source of sources.current) {
      try {
        source.stop();
      } catch {
        /* not started yet */
      }
    }
    sources.current = [];
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setState("idle");
  }, [stop]);

  /** true when the trainee can talk by voice at all (server STT or the browser recogniser). */
  const canListen = !!caps && (caps.stt || caps.browserStt);

  return { state, error, caps, canListen, listen, stop, say, cancel };
}
