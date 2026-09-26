"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PushToTalk } from "@/components/voice/PushToTalk";
import { useVoice } from "@/components/voice/useVoice";
import type { BookEntry, CallBrief } from "@/lib/dds/calls";
import { fmtDuration, fmtHM } from "@/lib/dds/format";
import { beep, postJson, useNow, withSeat } from "./client";
import { useDds } from "./DdsShell";
import { Book, Close, HandsetDown, Keypad, List, Phone } from "./icons";
import { SoftphoneContext, type SoftphoneApi } from "./softphone-context";

type Tab = "dial" | "log" | "book";

const KIND_LABEL: Record<CallBrief["kind"], string> = {
  CALLER_IN: "заявитель",
  BRIGADE_IN: "доклад наряда",
  BRIGADE_OUT: "наряд",
  CALLER_OUT: "заявитель",
  SERVICE_OUT: "служба",
  CONTROL_IN: "отдел контроля",
};

/**
 * Softphone of the ДДС place (text mode): an incoming call rings with a signal, the dispatcher answers,
 * talks by typing, hangs up; outgoing calls go from the keypad, the phone book or the phone icons of the card.
 */
export function SoftphoneLayer({ children }: { children: React.ReactNode }) {
  const { state, seatParam, offset, refresh } = useDds();
  const phone = state.phone;
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("book");
  const [number, setNumber] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const now = useNow(offset);
  // Voice: the counterpart's lines are spoken, the trainee may answer by push-to-talk; text stays as a fallback.
  const voice = useVoice();
  const { say, cancel } = voice;
  const [voiceOn, setVoiceOn] = useState(true);
  const spoken = useRef<{ callId: string; count: number }>({ callId: "", count: 0 });

  const ringing = phone?.ringing ?? [];
  const current = phone?.current ?? null;
  const live = state.seat.lessonStatus === "RUNNING" && !state.seat.readOnly;
  // The panel pops up by itself only on a live place; a watcher or a finished lesson opens it by hand.
  const visible = open || (live && (ringing.length > 0 || !!current));

  // The card open on the screen gives the context of calls from the keypad.
  const cardNumber = /\/dds\/incident\/(\d+)/.exec(pathname)?.[1];
  const cardIncidentId = useMemo(
    () => phone?.book.find((b) => b.group === `Карточка ${cardNumber}` && b.incidentId)?.incidentId ?? null,
    [phone?.book, cardNumber],
  );

  // Ring while an incoming call waits.
  const ringingId = live ? ringing[0]?.id : undefined;
  useEffect(() => {
    if (!ringingId) return;
    beep(660, 2, 220);
    const t = setInterval(() => beep(660, 2, 220), 2000);
    return () => clearInterval(t);
  }, [ringingId]);

  const lines = current?.messages.length ?? 0;
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines, current?.id]);

  // Speak every new line of the counterpart once, in the voice of the persona.
  useEffect(() => {
    if (!current) {
      spoken.current = { callId: "", count: 0 };
      return;
    }
    if (spoken.current.callId !== current.id) spoken.current = { callId: current.id, count: 0 };
    const fresh = current.messages.slice(spoken.current.count).filter((m) => m.role === "counterpart");
    spoken.current.count = current.messages.length;
    if (!voiceOn || !live || !fresh.length) return;
    void (async () => {
      for (const m of fresh) await say(m.text, current.voice);
    })();
  }, [current, voiceOn, live, say]);

  async function run(url: string, body?: unknown) {
    setBusy(true);
    setError(null);
    const res = await postJson(withSeat(url, seatParam), body);
    setBusy(false);
    if (!res.ok) setError(res.message);
    refresh();
    return res.ok;
  }

  const api: SoftphoneApi = {
    canDial: live && !current,
    crews: phone?.crews ?? [],
    dial: (value, opts) => {
      setOpen(true);
      void run("/api/dds/calls", { number: value, incidentId: opts?.incidentId ?? cardIncidentId });
    },
  };

  async function sayLine(text: string) {
    if (!current || !text.trim()) return;
    const ok = await run(`/api/dds/calls/${current.id}/say`, { text });
    if (!ok) setDraft(text);
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft;
    setDraft("");
    await sayLine(text);
  }

  async function talk() {
    const text = await voice.listen();
    if (text) await sayLine(text);
  }

  function hangUp(id: string) {
    cancel();
    void run(`/api/dds/calls/${id}/hangup`);
  }

  const missed = (phone?.log ?? []).filter((c) => c.status === "MISSED" && c.incoming).length;

  return (
    <SoftphoneContext.Provider value={api}>
      {children}
      {!visible ? (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-[76px] right-3 z-30 flex items-center gap-2 bg-arm-dark px-3 py-2 text-[13px] text-white shadow-lg hover:brightness-125"
          aria-label="Открыть телефон"
        >
          <Phone className="h-4 w-4" /> Телефон
          {missed ? <span className="rounded bg-arm-late px-1.5 text-[11px] font-bold" title="Пропущенные доклады">{missed}</span> : null}
        </button>
      ) : (
        <aside className="fixed bottom-[76px] right-3 z-30 flex max-h-[calc(100vh-96px)] w-[min(370px,calc(100vw-24px))] flex-col overflow-hidden border border-arm-dark/30 bg-white text-[13px] text-arm-dark shadow-2xl">
          <header className="flex items-center gap-2 bg-arm-dark px-3 py-2 text-white">
            <Phone className="h-4 w-4" />
            <span className="flex-1 truncate">
              {current
                ? `Разговор ${fmtDuration(now ? (now - Date.parse(current.answeredAt ?? current.startedAt)) / 1000 : 0)}`
                : ringing.length
                  ? "Входящий вызов"
                  : "Телефон · линия свободна"}
            </span>
            <button
              onClick={() => {
                if (voiceOn) cancel();
                setVoiceOn(!voiceOn);
              }}
              title={voiceOn ? "Собеседник говорит голосом — выключить" : "Включить голос собеседника"}
              aria-pressed={voiceOn}
              className={`rounded px-1.5 text-[11px] ${voiceOn ? "bg-white/20 text-white" : "text-white/60"}`}
            >
              {voiceOn ? "голос вкл." : "голос выкл."}
            </button>
            {!live || (!current && !ringing.length) ? (
              <button onClick={() => setOpen(false)} aria-label="Свернуть телефон" className="text-white/80 hover:text-white">
                <Close className="h-4 w-4" />
              </button>
            ) : null}
          </header>

          {error ? <div className="border-b border-arm-late/40 bg-[#fff1f0] px-3 py-1.5 text-[12px] text-arm-late">{error}</div> : null}

          {ringing.map((call) => (
            <div key={call.id} className="flex items-center gap-3 border-b bg-[#eaf6ea] px-3 py-2">
              <span className="grid h-9 w-9 animate-pulse place-items-center rounded-full bg-green-600 text-white">
                <Phone className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{call.name}</div>
                <div className="truncate text-[11px] text-arm-desc">
                  {call.role}
                  {call.incidentNumber ? ` · карточка ${call.incidentNumber}` : ""}
                </div>
              </div>
              {live ? (
                <>
                  <button disabled={busy || !!current} onClick={() => run(`/api/dds/calls/${call.id}/answer`)} className="bg-green-600 px-2 py-1 text-white disabled:opacity-50">
                    Ответить
                  </button>
                  <button disabled={busy} onClick={() => run(`/api/dds/calls/${call.id}/hangup`)} className="bg-arm-late px-2 py-1 text-white disabled:opacity-50" aria-label="Сбросить">
                    <HandsetDown className="h-4 w-4" />
                  </button>
                </>
              ) : null}
            </div>
          ))}

          {current ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="shrink-0 border-b px-3 py-2">
                <div className="font-semibold">{current.name}</div>
                <div className="text-[11px] text-arm-desc">
                  {current.role} · {KIND_LABEL[current.kind]}
                  {current.incidentNumber ? ` · карточка ${current.incidentNumber}` : ""}
                </div>
              </div>
              <div ref={messagesRef} className="min-h-[64px] flex-1 space-y-2 overflow-y-auto bg-arm-panel px-3 py-2 [@media(min-height:640px)]:min-h-[180px]">
                {current.messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === "trainee" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] px-2 py-1 ${m.role === "trainee" ? "bg-arm-blue text-white" : "bg-white"}`}>
                      <div className="text-[10px] opacity-70">{m.role === "trainee" ? "Вы" : current.name.split(" ")[0]} · {fmtHM(m.at)}</div>
                      {m.text}
                    </div>
                  </div>
                ))}
                {busy ? <div className="text-[11px] text-arm-desc">…</div> : null}
              </div>
              {live && voice.canListen ? (
                <div className="flex shrink-0 flex-wrap items-center gap-2 border-t px-2 pt-2">
                  <PushToTalk state={voice.state} onStart={() => void talk()} onStop={voice.stop} disabled={busy} />
                  {voice.error ? <span className="text-[11px] text-arm-late">{voice.error}</span> : null}
                </div>
              ) : null}
              {live ? (
                <>
                  <form onSubmit={send} className="flex shrink-0 gap-2 border-t px-2 py-2">
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Что вы говорите в трубку…"
                      aria-label="Реплика в разговоре"
                      maxLength={600}
                      className="min-w-0 flex-1 border-b border-arm-dark/40 py-1 outline-none"
                    />
                    <button disabled={busy || !draft.trim()} className="bg-arm-blue px-2 text-white disabled:opacity-50">
                      Сказать
                    </button>
                  </form>
                  <button
                    onClick={() => hangUp(current.id)}
                    className="flex shrink-0 items-center justify-center gap-2 bg-arm-late py-2 text-white hover:brightness-110"
                  >
                    <HandsetDown className="h-4 w-4" /> Положить трубку
                  </button>
                </>
              ) : null}
            </div>
          ) : !ringing.length ? (
            <div className="flex min-h-0 flex-1 flex-col">
              <nav className="flex border-b text-[12px]">
                {(
                  [
                    ["dial", "Набор", Keypad],
                    ["book", "Книжка", Book],
                    ["log", "Журнал", List],
                  ] as const
                ).map(([key, label, Icon]) => (
                  <button key={key} onClick={() => setTab(key)} className={`flex flex-1 items-center justify-center gap-1 py-2 ${tab === key ? "border-b-2 border-arm-blue font-semibold" : "text-arm-desc"}`}>
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
              </nav>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {tab === "dial" ? (
                  <DialPad number={number} setNumber={setNumber} disabled={!api.canDial || busy} onDial={() => number.trim() && api.dial(number.trim())} context={cardNumber} />
                ) : tab === "book" ? (
                  <PhoneBook entries={phone?.book ?? []} disabled={!api.canDial || busy} onDial={(e) => api.dial(e.phone, { incidentId: e.incidentId })} />
                ) : (
                  <CallLog calls={phone?.log ?? []} expanded={expanded} setExpanded={setExpanded} />
                )}
              </div>
            </div>
          ) : null}
        </aside>
      )}
    </SoftphoneContext.Provider>
  );
}

function DialPad(props: { number: string; setNumber: (v: string) => void; disabled: boolean; onDial: () => void; context?: string }) {
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];
  return (
    <div className="space-y-3 p-3">
      <input
        value={props.number}
        onChange={(e) => props.setNumber(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && !props.disabled && props.onDial()}
        placeholder="Номер или номер наряда"
        aria-label="Набираемый номер"
        className="w-full border-b border-arm-dark/40 py-1 text-center text-[20px] tracking-wider outline-none"
      />
      <div className="grid grid-cols-3 gap-1.5">
        {keys.map((k) => (
          <button key={k} onClick={() => props.setNumber(props.number + k)} className="border border-arm-dark/15 bg-arm-panel py-2 text-[16px] hover:bg-arm-header">
            {k}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={() => props.setNumber(props.number.slice(0, -1))} className="flex-1 border border-arm-dark/20 py-1.5">
          ← Стереть
        </button>
        <button disabled={props.disabled || !props.number.trim()} onClick={props.onDial} className="flex flex-[2] items-center justify-center gap-2 bg-green-600 py-1.5 text-white disabled:opacity-50">
          <Phone className="h-4 w-4" /> Вызов
        </button>
      </div>
      <p className="text-[11px] text-arm-desc">
        {props.context ? `Звонок пойдёт по карточке ${props.context}. ` : ""}Наряд можно вызвать по номеру наряда (например, 23).
      </p>
    </div>
  );
}

function PhoneBook({ entries, disabled, onDial }: { entries: BookEntry[]; disabled: boolean; onDial: (e: BookEntry) => void }) {
  const groups = entries.reduce<Record<string, BookEntry[]>>((acc, e) => {
    (acc[e.group] ??= []).push(e);
    return acc;
  }, {});
  if (!entries.length) return <p className="p-3 text-arm-desc">Книжка пуста.</p>;
  return (
    <div className="pb-2">
      {Object.entries(groups).map(([group, list]) => (
        <div key={group}>
          <div className="bg-arm-header px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-arm-desc">{group}</div>
          {list.map((e, i) => (
            <div key={`${group}-${i}`} className="flex items-center gap-2 border-b border-arm-dark/10 px-3 py-1.5">
              <div className="min-w-0 flex-1">
                <div className="truncate">{e.name}</div>
                <div className="truncate text-[11px] text-arm-desc">
                  {e.role} · {e.phone}
                </div>
              </div>
              <button disabled={disabled} onClick={() => onDial(e)} aria-label={`Позвонить: ${e.name}`} className="grid h-8 w-8 place-items-center bg-green-600 text-white disabled:opacity-40">
                <Phone className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function CallLog({ calls, expanded, setExpanded }: { calls: CallBrief[]; expanded: string | null; setExpanded: (id: string | null) => void }) {
  if (!calls.length) return <p className="p-3 text-arm-desc">Звонков ещё не было.</p>;
  return (
    <div>
      {calls.map((c) => {
        const duration = c.answeredAt && c.endedAt ? (Date.parse(c.endedAt) - Date.parse(c.answeredAt)) / 1000 : null;
        const status = c.status === "MISSED" ? "пропущен" : c.status === "RINGING" ? "звонит" : c.status === "ACTIVE" ? "идёт" : "завершён";
        return (
          <div key={c.id} className="border-b border-arm-dark/10">
            <button onClick={() => setExpanded(expanded === c.id ? null : c.id)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-arm-panel">
              <span className={c.incoming ? "text-green-700" : "text-arm-blue"} title={c.incoming ? "Входящий" : "Исходящий"}>
                {c.incoming ? "↙" : "↗"}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{c.name}</span>
                <span className="block truncate text-[11px] text-arm-desc">
                  {KIND_LABEL[c.kind]}
                  {c.incidentNumber ? ` · карточка ${c.incidentNumber}` : ""}
                </span>
              </span>
              <span className="text-right text-[11px]">
                <span className="block">{fmtHM(c.startedAt)}</span>
                <span className={`block ${c.status === "MISSED" ? "font-semibold text-arm-late" : "text-arm-desc"}`}>
                  {status}
                  {duration != null ? ` ${fmtDuration(duration)}` : ""}
                </span>
              </span>
            </button>
            {expanded === c.id && c.messages.length ? (
              <div className="space-y-1 bg-arm-panel px-3 py-2 text-[12px]">
                {c.messages.map((m, i) => (
                  <div key={i}>
                    <b>{m.role === "trainee" ? "Вы" : c.name.split(" ")[0]}:</b> {m.text}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
