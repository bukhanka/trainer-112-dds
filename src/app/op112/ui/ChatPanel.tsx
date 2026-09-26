"use client";
import { useEffect, useRef, useState } from "react";
import { PushToTalk } from "@/components/voice/PushToTalk";
import { useVoice } from "@/components/voice/useVoice";
import { askedAbout } from "@/lib/op112/facts";
import type { CallLine, FactTopic } from "@/lib/op112/types";
import type { CallDto } from "@/lib/op112/state";
import { IconCheck, IconHangup, IconSend, IconSpeaker, IconSpeakerOff } from "./icons";
import { hhmm, mmss } from "./format";

const QUICK = [
  "Служба 112, что случилось?",
  "Назовите адрес.",
  "Уточните номер дома и что рядом.",
  "Как вас зовут?",
  "Есть пострадавшие?",
  "Помощь выезжает, ожидайте.",
];

type Check = { label: string; topic: FactTopic };
const BASE: Check[] = [
  { label: "что случилось", topic: "what" },
  { label: "адрес", topic: "address" },
  { label: "дом, корпус, ориентир", topic: "addressExact" },
  { label: "фамилия и имя", topic: "name" },
  { label: "пострадавшие", topic: "victims" },
];
const BY_CARD: Record<string, Check[]> = {
  "101": [
    { label: "угроза людям", topic: "threat" },
    { label: "этажность", topic: "floors" },
    { label: "газификация", topic: "gas" },
    { label: "доступ", topic: "access" },
  ],
  "104": [
    { label: "магистральный газ или баллон", topic: "gas" },
    { label: "угроза людям", topic: "threat" },
  ],
  "103": [
    { label: "сознание", topic: "consciousness" },
    { label: "дыхание", topic: "breathing" },
    { label: "возраст", topic: "age" },
  ],
  dtp: [
    { label: "угроза людям", topic: "threat" },
    { label: "заблокированные", topic: "access" },
  ],
};

const MUTE_KEY = "op112.voiceMuted";
function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}
function writeMuted(v: boolean) {
  try {
    localStorage.setItem(MUTE_KEY, v ? "1" : "0");
  } catch {
    /* the choice is simply not remembered */
  }
}

export function ChatPanel(p: {
  call: CallDto | null;
  lines: CallLine[];
  pending: boolean;
  now: number;
  hints: boolean;
  cards: string[];
  onSend: (text: string) => void;
  onHangup: () => void;
}) {
  const [text, setText] = useState("");
  const [muted, setMuted] = useState(readMuted);
  const listRef = useRef<HTMLDivElement>(null);
  const spoken = useRef<string | null>(null);
  const active = p.call?.status === "ACTIVE";
  const voice = useVoice();
  const { say, cancel, listen, stop } = voice;
  const gender = p.call?.voice ?? "female";

  // The caller's new line is also spoken aloud (server synthesis or the browser's voices).
  const last = p.lines[p.lines.length - 1];
  const lastKey = last ? `${last.at}|${last.text}` : null;
  useEffect(() => {
    if (!last || last.role !== "counterpart" || !active || muted || spoken.current === lastKey) return;
    spoken.current = lastKey;
    void say(last.text, gender);
  }, [last, lastKey, active, muted, gender, say]);
  useEffect(() => {
    if (!active) cancel();
  }, [active, cancel]);

  const talk = async () => {
    if (!active || p.pending) return;
    const heard = await listen();
    if (heard.trim()) p.onSend(heard.trim());
  };

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [p.lines.length, p.pending]);

  const submit = (value: string) => {
    const v = value.trim();
    if (!v || !active || p.pending) return;
    p.onSend(v);
    setText("");
  };

  const talkSec = p.call?.answeredAt ? ((p.call.endedAt ? Date.parse(p.call.endedAt) : p.now) - Date.parse(p.call.answeredAt)) / 1000 : 0;
  const operatorLines = p.lines.filter((l) => l.role === "trainee").map((l) => l.text);
  const checks = [...BASE, ...p.cards.flatMap((c) => BY_CARD[c] ?? [])].filter(
    (c, i, arr) => arr.findIndex((x) => x.topic === c.topic) === i,
  );

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-[#b9c0c5] bg-white xl:w-[340px] 2xl:w-[390px]" aria-label="Разговор с заявителем">
      <div className="flex items-center justify-between bg-arm-dark px-3 py-2 text-white">
        <div className="min-w-0 leading-tight">
          <div className="text-[14px] font-semibold">Разговор с заявителем</div>
          <div className="truncate text-[12px] text-white/75">
            {p.call ? (active ? `на линии · ${mmss(talkSec)}` : `звонок завершён · ${mmss(talkSec)}`) : "нет вызова"}
          </div>
          {p.call?.phone && <div className="truncate text-[12px] text-white/75">{p.call.phone}</div>}
        </div>
        <button
          type="button"
          onClick={() => {
            const next = !muted;
            setMuted(next);
            writeMuted(next);
            if (next) cancel();
          }}
          aria-pressed={!muted}
          aria-label={muted ? "Включить голос заявителя" : "Выключить голос заявителя"}
          title={muted ? "Голос заявителя выключен — включить" : "Голос заявителя включён — выключить"}
          className="ml-auto mr-2 flex h-9 w-9 shrink-0 items-center justify-center border border-white/30 text-white/85 hover:bg-white/10"
        >
          {muted ? <IconSpeakerOff className="h-5 w-5" /> : <IconSpeaker className="h-5 w-5" />}
        </button>
        <button
          type="button"
          onClick={p.onHangup}
          disabled={!active}
          title="Завершить разговор"
          className="flex h-9 w-12 items-center justify-center bg-arm-late/90 hover:bg-arm-late disabled:bg-white/15 disabled:text-white/50"
        >
          <IconHangup className="h-6 w-6" />
        </button>
      </div>

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-[#f4f5f6] px-3 py-3" aria-live="polite">
        {!p.lines.length && <div className="m-auto text-center text-[13px] text-arm-desc">Здесь будет разговор с заявителем.</div>}
        {p.lines.map((l, i) => (
          <div key={i} className={`flex max-w-[88%] flex-col ${l.role === "trainee" ? "self-end items-end" : "self-start items-start"}`}>
            <div
              className={`px-3 py-2 text-[14px] leading-snug ${l.role === "trainee" ? "bg-arm-blue text-white" : "border border-[#dde1e3] bg-white text-arm-dark"}`}
            >
              {l.text}
            </div>
            <div className="mt-0.5 text-[10.5px] text-arm-desc">
              {l.role === "trainee" ? "Оператор" : "Заявитель"} · {hhmm(l.at)}
            </div>
          </div>
        ))}
        {p.pending && <div className="self-start text-[12.5px] italic text-arm-desc">Заявитель отвечает…</div>}
      </div>

      {p.hints && p.call && (
        <div className="border-t border-[#dde1e3] px-3 py-2">
          <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-arm-desc">Что спросить</div>
          <div className="flex flex-wrap gap-1">
            {checks.map((c) => {
              const done = askedAbout(c.topic, operatorLines);
              return (
                <span
                  key={c.topic}
                  className={`inline-flex items-center gap-1 border px-1.5 py-0.5 text-[11.5px] ${done ? "border-[#9fd0ad] bg-[#eaf7ee] text-[#1c6b33]" : "border-[#dde1e3] text-arm-desc"}`}
                >
                  {done && <IconCheck className="h-3 w-3" />}
                  {c.label}
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="border-t border-[#dde1e3] p-2">
        <div className="mb-1.5 flex items-center gap-2">
          <PushToTalk state={voice.state} onStart={talk} onStop={stop} disabled={!voice.canListen || !active || p.pending} />
          <span className="text-[11px] leading-tight text-arm-desc">
            {voice.canListen ? "или пробел, когда курсор не в поле" : "голосовой ввод недоступен — пишите текстом"}
          </span>
        </div>
        {voice.error && <div className="mb-1 text-[12px] text-arm-late">{voice.error}</div>}
        <div className="mb-1.5 flex flex-wrap gap-1">
          {QUICK.map((q) => (
            <button
              key={q}
              type="button"
              disabled={!active || p.pending}
              onClick={() => submit(q)}
              className="border border-[#c9ced1] bg-white px-1.5 py-0.5 text-[11.5px] text-arm-dark hover:border-arm-blue disabled:opacity-40"
            >
              {q}
            </button>
          ))}
        </div>
        <div className="flex items-end gap-1.5" data-hk="Alt+J">
          <textarea
            id="op112-chat"
            rows={2}
            value={text}
            disabled={!active}
            placeholder={active ? "Ваш вопрос заявителю… (Enter — сказать)" : "Разговор не идёт"}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.altKey) {
                e.preventDefault();
                submit(text);
              }
            }}
            className="min-h-[44px] flex-1 resize-none border border-[#b3bbc0] px-2 py-1.5 text-[14px] outline-none focus:border-arm-blue disabled:bg-[#f4f5f6]"
          />
          <button
            type="button"
            onClick={() => submit(text)}
            disabled={!active || p.pending || !text.trim()}
            title="Сказать"
            className="flex h-[44px] w-11 items-center justify-center bg-arm-blue text-white disabled:opacity-40"
          >
            <IconSend className="h-5 w-5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
