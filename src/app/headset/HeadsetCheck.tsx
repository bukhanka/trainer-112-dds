"use client";

import { useState } from "react";
import { PushToTalk } from "@/components/voice/PushToTalk";
import { useVoice } from "@/components/voice/useVoice";

export function HeadsetCheck() {
  const voice = useVoice();
  const [heard, setHeard] = useState<string[]>([]);

  async function onStart() {
    const text = await voice.listen();
    if (text) setHeard((h) => [text, ...h].slice(0, 5));
  }

  return (
    <div className="flex flex-col gap-4 rounded border bg-white p-4">
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">1. Звук</h2>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => voice.say("Алло, служба сто двенадцать? У меня во дворе горит мусорный контейнер!", "female")}
            className="rounded border px-3 py-1.5 text-sm hover:bg-arm-panel"
          >
            Женский голос
          </button>
          <button
            onClick={() => voice.say("Диспетчер, бригада прибыла на место, приступаем к работам.", "male")}
            className="rounded border px-3 py-1.5 text-sm hover:bg-arm-panel"
          >
            Мужской голос
          </button>
        </div>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">2. Микрофон</h2>
        <p className="text-sm text-arm-desc">Удерживайте кнопку или пробел и скажите: «Служба сто двенадцать, что у вас случилось?»</p>
        <PushToTalk state={voice.state} onStart={onStart} onStop={voice.stop} disabled={!voice.canListen} />
        {voice.error && <p className="text-sm text-arm-late">{voice.error}</p>}
        {heard.length > 0 && (
          <ul className="text-sm">
            {heard.map((t, i) => (
              <li key={i} className={i === 0 ? "font-semibold" : "text-arm-desc"}>
                «{t}»
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="text-xs text-arm-desc">
        Распознавание: {voice.caps ? (voice.caps.stt ? "сервер" : voice.caps.browserStt ? "браузер" : "недоступно") : "…"} ·
        синтез: {voice.caps ? (voice.caps.tts ? "сервер" : "браузер") : "…"}
      </p>
    </div>
  );
}
