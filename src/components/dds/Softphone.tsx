"use client";

import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { PushToTalk } from "@/components/voice/PushToTalk";
import { TalkModeSwitch, useTalkMode, type TalkMode } from "@/components/voice/TalkMode";
import { useVoice } from "@/components/voice/useVoice";
import type { BookEntry, CallBrief, CallMessage } from "@/lib/dds/calls";
import { fmtDuration, fmtHM } from "@/lib/dds/format";
import { heldSeconds, openHold, type HoldPeriod } from "@/lib/dds/hold";
import { beep, postJson, useNow, withSeat } from "./client";
import { useDds } from "./DdsShell";
import { Book, Close, HandsetDown, Keypad, List, Pause, Phone } from "./icons";
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
 * Softphone of the ДДС place: an incoming call rings with a signal, the dispatcher answers, talks by voice or by
 * typing («Голос / Текст», see TalkMode), hangs up; outgoing calls go from the keypad, the phone book or the phone
 * icons of the card. «Удержание» parks the conversation: the counterpart waits, the line is free for another call.
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
  // «Голос»: the counterpart's lines are spoken and the trainee answers by push-to-talk; «Текст»: typed, not spoken.
  const voice = useVoice();
  const { say, cancel } = voice;
  const [mode, setMode, settled] = useTalkMode(voice.caps ? voice.canListen : undefined);
  const switchTo = (next: TalkMode) => {
    if (next === "text") cancel();
    setMode(next);
  };
  // Lines already spoken, per call: a call back from hold must not repeat the whole conversation.
  const spoken = useRef(new Map<string, number>());

  const ringing = phone?.ringing ?? [];
  const current = phone?.current ?? null;
  const held = phone?.held ?? [];
  const live = state.seat.lessonStatus === "RUNNING" && !state.seat.readOnly;
  // The panel pops up by itself only on a live place; a watcher or a finished lesson opens it by hand.
  const visible = open || (live && (ringing.length > 0 || !!current || held.length > 0));

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
    if (!current || !settled) return;
    const from = spoken.current.get(current.id) ?? firstUnspoken(current);
    const fresh = current.messages.slice(from).filter((m) => m.role === "counterpart");
    spoken.current.set(current.id, current.messages.length);
    if (mode !== "voice" || !live || !fresh.length) return;
    void (async () => {
      for (const m of fresh) await say(m.text, current.voice, current.manner);
    })();
  }, [current, mode, settled, live, say]);

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
      // Without a card named by the caller the card open on the screen is the context of the call.
      void run("/api/dds/calls", { number: value, incidentId: opts?.incidentId ?? cardIncidentId, cardNumber: cardNumber ? Number(cardNumber) : null });
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
    setMode("voice");
    const text = await voice.listen();
    if (text) await sayLine(text);
  }

  function hangUp(id: string) {
    cancel();
    void run(`/api/dds/calls/${id}/hangup`);
  }

  function holdCall(id: string) {
    cancel();
    void run(`/api/dds/calls/${id}/hold`);
  }

  /** «Удержать и ответить»: the conversation waits while the dispatcher takes the ringing call. */
  async function holdAndAnswer(ringingId: string) {
    cancel();
    const parked = current?.id;
    if (parked && !(await run(`/api/dds/calls/${parked}/hold`))) return;
    // The ringing call is gone (lost or taken): back to the conversation that was parked for it.
    if (!(await run(`/api/dds/calls/${ringingId}/answer`)) && parked) await run(`/api/dds/calls/${parked}/resume`);
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
                ? `${mode === "voice" ? "Расшифровка разговора ·" : "Разговор"} ${fmtDuration(now ? (now - Date.parse(current.answeredAt ?? current.startedAt)) / 1000 : 0)}`
                : ringing.length
                  ? "Входящий вызов"
                  : held.length
                    ? `На удержании ${fmtDuration(holdSec(held[0], now))}`
                    : "Телефон · линия свободна"}
            </span>
            <TalkModeSwitch mode={mode} onChange={switchTo} />
            {!live || (!current && !ringing.length && !held.length) ? (
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
                  {current ? (
                    <button
                      disabled={busy}
                      onClick={() => void holdAndAnswer(call.id)}
                      title="Текущий разговор встанет на удержание"
                      className="bg-green-600 px-2 py-1 text-[12px] leading-tight text-white disabled:opacity-50"
                    >
                      Удержать и ответить
                    </button>
                  ) : (
                    <button disabled={busy} onClick={() => run(`/api/dds/calls/${call.id}/answer`)} className="bg-green-600 px-2 py-1 text-white disabled:opacity-50">
                      Ответить
                    </button>
                  )}
                  <button disabled={busy} onClick={() => run(`/api/dds/calls/${call.id}/hangup`)} className="bg-arm-late px-2 py-1 text-white disabled:opacity-50" aria-label="Сбросить">
                    <HandsetDown className="h-4 w-4" />
                  </button>
                </>
              ) : null}
            </div>
          ))}

          {held.map((call) => (
            <div key={call.id} className="flex items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-2">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-amber-500 text-white" aria-hidden>
                <Pause className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{call.name}</div>
                <div className="truncate text-[11px] text-arm-desc">
                  на удержании <b className="tabular-nums text-amber-800">{fmtDuration(holdSec(call, now))}</b> · {KIND_LABEL[call.kind]}
                  {call.incidentNumber ? ` · карточка ${call.incidentNumber}` : ""}
                </div>
              </div>
              {live ? (
                <>
                  <button
                    disabled={busy}
                    onClick={() => {
                      cancel();
                      void run(`/api/dds/calls/${call.id}/resume`);
                    }}
                    title={current ? "Текущий разговор встанет на удержание" : "Вернуться к разговору"}
                    className="bg-arm-blue px-2 py-1 text-[12px] leading-tight text-white disabled:opacity-50"
                  >
                    Снять с удержания
                  </button>
                  <button disabled={busy} onClick={() => hangUp(call.id)} className="bg-arm-late px-2 py-1 text-white disabled:opacity-50" aria-label={`Положить трубку: ${call.name}`}>
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
                {transcript(current).map((item, i) =>
                  item.hold ? (
                    <HoldMark key={i} sec={heldSeconds([item.hold], now)} />
                  ) : (
                    <div key={i} className={`flex ${item.line.role === "trainee" ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[85%] px-2 py-1 ${item.line.role === "trainee" ? "bg-arm-blue text-white" : "bg-white"}`}>
                        <div className="text-[10px] opacity-70">
                          {item.line.role === "trainee" ? "Вы" : current.name.split(" ")[0]} · {fmtHM(item.line.at)}
                        </div>
                        {item.line.text}
                      </div>
                    </div>
                  ),
                )}
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
                      onChange={(e) => {
                        setDraft(e.target.value);
                        // Typing is talking by text: the mode becomes «Текст» and the voice stops.
                        if (mode !== "text") switchTo("text");
                      }}
                      placeholder="Что вы говорите в трубку…"
                      aria-label="Реплика в разговоре"
                      maxLength={600}
                      className="min-w-0 flex-1 border-b border-arm-dark/40 py-1 outline-none"
                    />
                    <button disabled={busy || !draft.trim()} className="bg-arm-blue px-2 text-white disabled:opacity-50">
                      Сказать
                    </button>
                  </form>
                  <div className="flex shrink-0">
                    <button
                      disabled={busy}
                      onClick={() => holdCall(current.id)}
                      title="Собеседник подождёт на линии, а вы сможете принять или сделать другой звонок"
                      className="flex flex-1 items-center justify-center gap-2 bg-amber-500 py-2 text-white hover:brightness-110 disabled:opacity-50"
                    >
                      <Pause className="h-4 w-4" /> Удержание
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => hangUp(current.id)}
                      className="flex flex-[1.4] items-center justify-center gap-2 bg-arm-late py-2 text-white hover:brightness-110 disabled:opacity-50"
                    >
                      <HandsetDown className="h-4 w-4" /> Положить трубку
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          ) : !ringing.length ? (
            <div className="flex min-h-0 flex-1 flex-col">
              {held.length ? (
                <p className="border-b bg-arm-panel px-3 py-1.5 text-[11px] text-arm-desc">Линия свободна: пока собеседник ждёт, можно позвонить наряду или в другую службу.</p>
              ) : null}
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
                  <PhoneBook entries={phone?.book ?? []} openCard={cardNumber} disabled={!api.canDial || busy} onDial={(e) => api.dial(e.phone, { incidentId: e.incidentId })} />
                ) : (
                  <CallLog calls={phone?.log ?? []} expanded={expanded} setExpanded={setExpanded} now={now} />
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

/** The phone book; on an open card its section comes first, so «заявитель» there is the applicant of this card. */
function PhoneBook({ entries, openCard, disabled, onDial }: { entries: BookEntry[]; openCard?: string; disabled: boolean; onDial: (e: BookEntry) => void }) {
  const own = openCard ? `Карточка ${openCard}` : null;
  const groups = entries.reduce<Record<string, BookEntry[]>>((acc, e) => {
    (acc[e.group] ??= []).push(e);
    return acc;
  }, {});
  const sections = Object.entries(groups).sort(([a], [b]) => Number(b === own) - Number(a === own));
  if (!entries.length) return <p className="p-3 text-arm-desc">Книжка пуста.</p>;
  return (
    <div className="pb-2">
      {sections.map(([group, list]) => (
        <div key={group}>
          <div className={`px-3 py-1 text-[11px] font-semibold uppercase tracking-wide ${group === own ? "bg-arm-blue text-white" : "bg-arm-header text-arm-desc"}`}>
            {group === own ? `Открытая карточка ${openCard}` : group}
          </div>
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

function CallLog({ calls, expanded, setExpanded, now }: { calls: CallBrief[]; expanded: string | null; setExpanded: (id: string | null) => void; now: number }) {
  if (!calls.length) return <p className="p-3 text-arm-desc">Звонков ещё не было.</p>;
  return (
    <div>
      {calls.map((c) => {
        const duration = c.answeredAt && c.endedAt ? (Date.parse(c.endedAt) - Date.parse(c.answeredAt)) / 1000 : null;
        const status =
          c.status === "MISSED" ? "пропущен" : c.status === "RINGING" ? "звонит" : c.status === "ACTIVE" ? "идёт" : c.status === "HELD" ? "на удержании" : "завершён";
        const until = c.endedAt ? Date.parse(c.endedAt) : now;
        const waited = c.holds.length && until ? heldSeconds(c.holds, until) : 0;
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
                <span className={`block ${c.status === "MISSED" ? "font-semibold text-arm-late" : c.status === "HELD" ? "font-semibold text-amber-700" : "text-arm-desc"}`}>
                  {status}
                  {duration != null ? ` ${fmtDuration(duration)}` : ""}
                </span>
                {waited ? <span className="block text-amber-700">удержание {fmtDuration(waited)}</span> : null}
              </span>
            </button>
            {expanded === c.id && c.messages.length ? (
              <div className="space-y-1 bg-arm-panel px-3 py-2 text-[12px]">
                {transcript(c).map((item, i) =>
                  item.hold ? (
                    <HoldMark key={i} sec={heldSeconds([item.hold], until)} />
                  ) : (
                    <div key={i}>
                      <b>{item.line.role === "trainee" ? "Вы" : c.name.split(" ")[0]}:</b> {item.line.text}
                    </div>
                  ),
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

// ─── «Удержание» ────────────────────────────────────────────────────────────

/** Seconds the counterpart of a held call has been waiting in the current hold. */
function holdSec(call: CallBrief, now: number): number {
  const open = openHold(call.holds);
  return open && now ? Math.max(0, (now - Date.parse(open.from)) / 1000) : 0;
}

/** A call seen for the first time after a reload: only the lines after the last return from hold are new. */
function firstUnspoken(call: CallBrief): number {
  const back = call.holds.at(-1)?.to;
  if (!back) return 0;
  const i = call.messages.findIndex((m) => Date.parse(m.at) >= Date.parse(back));
  return i < 0 ? call.messages.length : i;
}

type TranscriptItem = { line: CallMessage; hold?: undefined } | { hold: HoldPeriod; line?: undefined };

/** The lines of a call with its hold periods in between, in time order. */
function transcript(call: CallBrief): TranscriptItem[] {
  const items: (TranscriptItem & { at: number })[] = [
    ...call.messages.map((line) => ({ line, at: Date.parse(line.at) })),
    ...call.holds.map((hold) => ({ hold, at: Date.parse(hold.from) })),
  ];
  return items.sort((a, b) => a.at - b.at);
}

function HoldMark({ sec }: { sec: number }) {
  return (
    <div className="flex items-center gap-2 text-[11px] text-amber-800">
      <span className="h-px flex-1 bg-amber-300" />
      <Pause className="h-3 w-3" /> удержание {fmtDuration(sec)}
      <span className="h-px flex-1 bg-amber-300" />
    </div>
  );
}
