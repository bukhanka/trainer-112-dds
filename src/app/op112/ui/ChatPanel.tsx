"use client";
import { useEffect, useRef, useState } from "react";
import { PushToTalk } from "@/components/voice/PushToTalk";
import { TalkModeSwitch, useTalkMode, type TalkMode } from "@/components/voice/TalkMode";
import { useVoice } from "@/components/voice/useVoice";
import { askedAbout } from "@/lib/op112/facts";
import type { CallLine, FactTopic } from "@/lib/op112/types";
import type { CallDto } from "@/lib/op112/state";
import { IconCheck, IconHangup, IconSend } from "./icons";
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
  "102": [
    { label: "оружие", topic: "weapon" },
    { label: "сколько человек", topic: "people" },
    { label: "приметы", topic: "object" },
  ],
  ДТП: [
    { label: "угроза людям", topic: "threat" },
    { label: "заблокированные", topic: "access" },
    { label: "машины, номера", topic: "object" },
  ],
  Взрыв: [
    { label: "угроза людям", topic: "threat" },
    { label: "угроза обрушения", topic: "threat" },
  ],
};

export function ChatPanel(p: {
  call: CallDto | null;
  lines: CallLine[];
  pending: boolean;
  now: number;
  hints: boolean;
  cards: string[];
  /** A call from the work-off row: its own title, the other side's name and ready phrases. */
  title?: string;
  who?: string;
  quick?: string[];
  /** Switch between the caller and the calls to services. */
  tabs?: React.ReactNode;
  onSend: (text: string) => void;
  onHangup: () => void;
}) {
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const spoken = useRef<string | null>(null);
  const active = p.call?.status === "ACTIVE";
  const voice = useVoice();
  const { say, cancel, listen, stop } = voice;
  const [mode, setMode, settled] = useTalkMode(voice.caps ? voice.canListen : undefined);
  const gender = p.call?.voice ?? "female";
  const manner = p.call?.manner ?? "calm";
  const switchTo = (next: TalkMode) => {
    if (next === "text") cancel();
    setMode(next);
  };

  // In «Голос» the caller's new line is spoken aloud (server synthesis or the browser's voices); in «Текст» it is
  // only shown — and it is not spoken later either, when the trainee switches to «Голос».
  const last = p.lines[p.lines.length - 1];
  const lastKey = last ? `${last.at}|${last.text}` : null;
  useEffect(() => {
    // Silence and beeps are what the operator hears, not words: they are shown, never read out.
    if (!last || last.role !== "counterpart" || last.noise || !active || !settled || spoken.current === lastKey) return;
    spoken.current = lastKey;
    if (mode === "voice") void say(last.text, gender, manner);
  }, [last, lastKey, active, mode, settled, gender, manner, say]);
  useEffect(() => {
    if (!active) cancel();
  }, [active, cancel]);

  // «Говорить» (the button or Space) is talking by voice: the mode becomes «Голос».
  const talk = async () => {
    if (!active || p.pending) return;
    setMode("voice");
    const heard = await listen();
    if (heard.trim()) p.onSend(heard.trim());
  };

  // Hold Space to talk — but not while Space types a space or presses a focused button of the card.
  const talkRef = useRef(talk);
  useEffect(() => {
    talkRef.current = talk;
  });
  const held = useRef(false);
  const canTalk = active && voice.canListen;
  useEffect(() => {
    if (!canTalk) return;
    const busy = (el: EventTarget | null) =>
      el instanceof HTMLElement &&
      (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(el.tagName) || el.getAttribute("role") === "button");
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat || held.current || e.altKey || e.ctrlKey || e.metaKey || busy(e.target)) return;
      e.preventDefault();
      held.current = true;
      void talkRef.current();
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space" || !held.current) return;
      e.preventDefault();
      held.current = false;
      stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [canTalk, stop]);

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

  // In «Голос» the panel is the transcript of a spoken conversation.
  const title = mode === "voice" ? "Расшифровка разговора" : (p.title ?? "Разговор с заявителем");
  const status = p.call ? (active ? `на линии · ${mmss(talkSec)}` : `звонок завершён · ${mmss(talkSec)}`) : "нет вызова";

  return (
    <aside className="flex w-[300px] shrink-0 flex-col border-l border-[#b9c0c5] bg-white xl:w-[340px] 2xl:w-[390px]" aria-label={title}>
      {/* The title has the whole width next to the handset; «Голос / Текст» sits under it, by the phone number. */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 bg-arm-dark px-3 py-2 text-white">
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[14px] font-semibold" title={title}>
            {title}
          </div>
          <div className="truncate text-[12px] text-white/75">{mode === "voice" && p.title ? `${p.title} · ${status}` : status}</div>
        </div>
        <button
          type="button"
          onClick={p.onHangup}
          disabled={!active}
          title="Завершить разговор"
          className="row-span-2 flex h-9 w-12 items-center justify-center bg-arm-late/90 hover:bg-arm-late disabled:bg-white/15 disabled:text-white/50"
        >
          <IconHangup className="h-6 w-6" />
        </button>
        <div className="mt-1 flex min-w-0 items-center justify-between gap-2">
          <div className="truncate text-[12px] text-white/75">{p.call?.phone ?? ""}</div>
          <TalkModeSwitch mode={mode} onChange={switchTo} />
        </div>
      </div>

      {p.tabs}
      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto bg-[#f4f5f6] px-3 py-3" aria-live="polite">
        {!p.lines.length && (
          <div className="m-auto text-center text-[13px] text-arm-desc">
            {mode === "voice" ? "Здесь появится расшифровка разговора." : "Здесь будет разговор с заявителем."}
          </div>
        )}
        {p.lines.map((l, i) =>
          l.noise ? (
            <div key={i} className="self-center px-2 text-center text-[13px] italic text-arm-desc" data-noise={l.noise}>
              {l.text}
            </div>
          ) : (
            <div key={i} className={`flex max-w-[88%] flex-col ${l.role === "trainee" ? "self-end items-end" : "self-start items-start"}`}>
              <div
                className={`px-3 py-2 text-[14px] leading-snug ${l.role === "trainee" ? "bg-arm-blue text-white" : "border border-[#dde1e3] bg-white text-arm-dark"}`}
              >
                {l.text}
              </div>
              <div className="mt-0.5 text-[10.5px] text-arm-desc">
                {l.role === "trainee" ? "Оператор" : (p.who ?? "Заявитель")} · {hhmm(l.at)}
              </div>
            </div>
          ),
        )}
        {p.pending && <div className="self-start text-[12.5px] italic text-arm-desc">{p.who ?? "Заявитель"} отвечает…</div>}
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
          <PushToTalk state={voice.state} onStart={talk} onStop={stop} disabled={!voice.canListen || !active || p.pending} spaceKey={false} />
          <span className="text-[11px] leading-tight text-arm-desc">
            {voice.canListen ? "или пробел, когда курсор не в поле" : "голосовой ввод недоступен — пишите текстом"}
          </span>
        </div>
        {voice.error && <div className="mb-1 text-[12px] text-arm-late">{voice.error}</div>}
        <div className="mb-1.5 flex flex-wrap gap-1">
          {(p.quick ?? QUICK).map((q) => (
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
            maxLength={1000}
            value={text}
            disabled={!active}
            placeholder={active ? (p.who ? "Что сказать службе… (Enter — сказать)" : "Ваш вопрос заявителю… (Enter — сказать)") : "Разговор не идёт"}
            onChange={(e) => {
              setText(e.target.value);
              // Typing is talking by text: the mode becomes «Текст» and the voice stops.
              if (mode !== "text") switchTo("text");
            }}
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
