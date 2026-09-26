"use client";
import { useEffect, useState } from "react";
import useSWR from "swr";
import type { IncidentCaller } from "@/lib/incident/types";
import type { CallDto, IncidentDto, Op112State } from "@/lib/op112/state";
import type { CallLine, Op112CardDraft, RoutedService } from "@/lib/op112/types";
import { ApiError, getJson, send, useNow, type StateWithClock } from "./client";
import { TopBar } from "./TopBar";
import { AddressBlock, CallerRow, DescriptionBlock } from "./LeftColumn";
import { FlagsBar, TypeBlock } from "./RightColumn";
import { AddServicesModal, EmptyCardModal, NotifyModal, ServicesBar, type Plate, type ServiceItem } from "./Services";
import { ChatPanel } from "./ChatPanel";
import { dateTime, mmss } from "./format";
import type { Notify } from "./Workstation";

type Directory = { services: ServiceItem[]; okrugs: string[]; districts: { okrug: string; district: string }[] };
type ModalState = null | "add" | "notify" | { empty: "noContact" | "dropped" };
type TopFlag = "victims" | "refusedAmbulance" | "noAccess";

// Manual additions live in the browser until «сохранить» (the draft on the server has no plates yet).
const manualKey = (id: string) => `op112.manual.${id}`;
function readManual(id: string): number[] {
  try {
    const v = JSON.parse(localStorage.getItem(manualKey(id)) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "number") : [];
  } catch {
    return [];
  }
}
function writeManual(id: string, ids: number[] | null) {
  try {
    if (ids?.length) localStorage.setItem(manualKey(id), JSON.stringify(ids));
    else localStorage.removeItem(manualKey(id));
  } catch {
    /* private mode: additions just are not remembered across reloads */
  }
}

function focusById(id: string) {
  const el = document.getElementById(id) as HTMLElement | null;
  el?.scrollIntoView({ block: "nearest" });
  el?.focus();
}

export function CardScreen(p: {
  state: StateWithClock;
  incident: IncidentDto;
  call: CallDto | null;
  apply: (s: Op112State) => void;
  notify: Notify;
  onClosed: (incidentId: string, number: number) => void;
}) {
  const { incident, state, notify } = p;
  const readOnly = incident.status !== "draft";
  const saved = incident.status === "registered";

  const [draft, setDraft] = useState<Op112CardDraft>(() => ({ ...incident.draft, manualServiceIds: readManual(incident.id) }));
  const [lines, setLines] = useState<CallLine[]>(() => p.call?.messages ?? []);
  const [call, setCall] = useState<CallDto | null>(p.call);
  const [pending, setPending] = useState(false);
  const [autoPlates, setAutoPlates] = useState<RoutedService[]>([]);
  const [lastSave, setLastSave] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [busy, setBusy] = useState(false);
  const [important, setImportant] = useState(incident.important);
  const { data: dir } = useSWR<Directory>("/api/op112/services", getJson, { revalidateOnFocus: false });
  const tick = useNow();
  const now = tick ? tick + state.clockOffset : Date.parse(state.serverNow);

  // Autosave of the draft, so a reload or a teacher's screen sees the card as it is being filled.
  useEffect(() => {
    if (readOnly) return;
    const t = setTimeout(() => {
      send<{ savedAt: string }>(`/api/op112/incidents/${incident.id}`, { draft }, "PATCH")
        .then((r) => setLastSave(r.savedAt))
        .catch(() => undefined);
    }, 700);
    return () => clearTimeout(t);
  }, [draft, readOnly, incident.id]);

  // Plates picked by the system for the card as it is now.
  const { cards, answers, flags, address } = draft;
  useEffect(() => {
    if (readOnly) return;
    const t = setTimeout(() => {
      send<{ services: RoutedService[] }>("/api/op112/route-preview", { cards, answers, flags, address })
        .then((r) => setAutoPlates(r.services))
        .catch(() => undefined);
    }, 200);
    return () => clearTimeout(t);
  }, [cards, answers, flags, address, readOnly]);

  const patch = (x: Partial<Op112CardDraft>) => setDraft((d) => ({ ...d, ...x }));
  const setCaller = (c: Partial<IncidentCaller>) => setDraft((d) => ({ ...d, caller: { ...d.caller, ...c } }));
  const toggleFlag = (f: TopFlag) => setDraft((d) => ({ ...d, flags: { ...d.flags, [f]: d.flags[f] ? undefined : true } }));
  const setManual = (ids: number[]) => {
    patch({ manualServiceIds: ids });
    writeManual(incident.id, ids);
  };

  const byId = new Map((dir?.services ?? []).map((s) => [s.id, s]));
  const plates: Plate[] = readOnly
    ? incident.plates
    : [
        ...autoPlates.map((r) => ({
          serviceId: r.serviceId,
          shortName: byId.get(r.serviceId)?.shortName ?? `#${r.serviceId}`,
          fullName: byId.get(r.serviceId)?.fullName,
          isMain: r.isMain,
          auto: true,
        })),
        ...draft.manualServiceIds
          .filter((id) => !autoPlates.some((a) => a.serviceId === id))
          .map((id) => ({ serviceId: id, shortName: byId.get(id)?.shortName ?? `#${id}`, fullName: byId.get(id)?.fullName, isMain: false, auto: false })),
      ];

  const warnings = [
    !draft.caller.fullName?.trim() && "фамилия и имя заявителя",
    !draft.caller.status && "статус заявителя",
    !draft.caller.provided && "предоставленный телефон",
    !(draft.address.street || draft.address.descriptive) && "адрес",
    !draft.cards.length && "тип происшествия («что случилось»)",
    !draft.description.trim() && "описание со слов заявителя",
  ].filter((w): w is string => Boolean(w));

  const say = async (text: string) => {
    if (!call) return;
    setLines((l) => [...l, { role: "trainee", text, at: new Date().toISOString() }]);
    setPending(true);
    try {
      const r = await send<{ lines: CallLine[]; status: string }>(`/api/op112/calls/${call.id}/messages`, { text });
      setLines((l) => [...l, ...r.lines.filter((x) => x.role === "counterpart")]);
      if (r.status !== "ACTIVE") setCall((c) => (c ? { ...c, status: "ENDED" } : c));
    } catch (e) {
      if (e instanceof ApiError && e.code === "call_not_active") {
        setCall((c) => (c ? { ...c, status: "ENDED" } : c));
        notify("Разговор уже завершён");
      } else notify("Заявитель не расслышал — повторите вопрос");
    } finally {
      setPending(false);
    }
  };

  const hangup = async () => {
    if (!call || call.status !== "ACTIVE") return;
    const r = await send<{ endedAt: string }>(`/api/op112/calls/${call.id}/hangup`).catch(() => null);
    setCall((c) => (c ? { ...c, status: "ENDED", endedAt: r?.endedAt ?? new Date().toISOString() } : c));
  };

  const save = async () => {
    setBusy(true);
    try {
      const s = await send<Op112State>(`/api/op112/incidents/${incident.id}/save`, { draft });
      setModal(null);
      setCall((c) => (c && c.status === "ACTIVE" ? { ...c, status: "ENDED", endedAt: new Date().toISOString() } : c));
      writeManual(incident.id, null);
      p.apply(s);
    } catch {
      notify("Карточка не сохранилась — попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  };

  const worked = async () => {
    setBusy(true);
    try {
      const s = await send<Op112State>(`/api/op112/incidents/${incident.id}/worked`);
      p.onClosed(incident.id, incident.number);
      p.apply(s);
    } catch {
      notify("Не удалось закрыть карточку");
      setBusy(false);
    }
  };

  const saveEmpty = async (reason: "noContact" | "dropped") => {
    setBusy(true);
    try {
      const s = await send<Op112State>(`/api/op112/incidents/${incident.id}/empty`, { reason });
      writeManual(incident.id, null);
      p.onClosed(incident.id, incident.number);
      p.apply(s);
    } catch {
      notify("Не удалось сохранить пустую карточку");
      setBusy(false);
    }
  };

  const toggleImportant = () => {
    const next = !important;
    setImportant(next);
    send(`/api/op112/incidents/${incident.id}`, { important: next }, "PATCH").catch(() => setImportant(!next));
    notify(next ? "Отмечено как важное происшествие" : "Отметка «важное» снята");
  };

  // Workstation shortcuts (instruction for the 112 operator): Alt + key, layout-independent.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (modal) {
          e.preventDefault();
          setModal(null);
        }
        return;
      }
      if (!e.altKey || e.metaKey) return;
      if (modal && e.code !== "KeyS") return;
      let handled = true;
      if (e.ctrlKey && /^Digit[1-9]$/.test(e.code)) {
        // Alt+Ctrl+n — n-th question of the card being filled.
        const n = Number(e.code.slice(5));
        const section = (document.activeElement as HTMLElement | null)?.closest("section[id^='op112-card-']") ?? document.getElementById("op112-card-1");
        const row = section?.querySelectorAll("[data-row]")[n - 1];
        (row?.querySelector("button:not(:disabled), input") as HTMLElement | null)?.focus();
      } else if (/^Digit[1-9]$/.test(e.code)) {
        const el = document.getElementById(`op112-card-${e.code.slice(5)}`);
        el?.scrollIntoView({ block: "nearest" });
        (el?.querySelector("[data-row] button:not(:disabled), [data-row] input") as HTMLElement | null)?.focus();
      } else {
        switch (e.code) {
          case "F1":
            focusById("op112-aon");
            break;
          case "F2":
            focusById("op112-provided");
            break;
          case "F3":
            focusById("op112-onsite");
            break;
          case "KeyK":
            focusById("op112-channel");
            break;
          case "KeyQ":
            focusById("op112-name");
            break;
          case "KeyA":
            focusById("op112-address");
            break;
          case "KeyP":
            if (!readOnly) toggleFlag("victims");
            break;
          case "KeyN":
            if (!readOnly && !draft.cards.length) setModal({ empty: "noContact" });
            break;
          case "KeyT":
            focusById("op112-type");
            break;
          case "KeyR":
            focusById("op112-significant");
            break;
          case "KeyO":
            focusById("op112-description");
            break;
          case "KeyZ":
            if (!readOnly) setModal("add");
            break;
          case "KeyS":
            if (modal === "notify") void save();
            else if (!modal) {
              if (saved) void worked();
              else if (!readOnly) setModal("notify");
            }
            break;
          case "KeyV":
            toggleImportant();
            break;
          case "KeyJ":
            focusById("op112-chat");
            break;
          case "KeyW":
          case "KeyB":
          case "KeyM":
            notify("Эта функция в учебной версии не используется");
            break;
          default:
            handled = false;
        }
      }
      if (handled) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const openedMs = incident.openedAt ? Date.parse(incident.openedAt) : now;
  const endMs = incident.savedAt ? Date.parse(incident.savedAt) : now;
  const typingSec = Math.max(0, (endMs - openedMs) / 1000);
  const limit = state.lesson?.typingSec ?? 65;
  const talking = call?.status === "ACTIVE" && !readOnly;
  const talkSec = call?.answeredAt ? (now - Date.parse(call.answeredAt)) / 1000 : 0;
  const savedLabel = incident.savedAt ? dateTime(incident.savedAt) : lastSave ? dateTime(lastSave) : null;

  return (
    <>
      <TopBar
        telephony={talking ? { label: `Разговор ${mmss(talkSec)}`, tone: "talk" } : { label: "Недоступен", tone: "busy" }}
        canHangup={talking}
        onHangup={hangup}
        caller={draft.caller}
        onCaller={setCaller}
        editable={!readOnly}
        incident={{ number: incident.number, savedLabel }}
        operatorNo={state.user.operatorNo}
        armNo={state.seat?.armNo ?? "1"}
        timer={{ sec: typingSec, late: typingSec > limit, running: !incident.savedAt }}
        onNotAvailable={(what) => notify(`${what}: в учебной версии не используется`)}
      />
      <div className="flex min-h-0 flex-1">
        <main className="flex min-h-0 min-w-0 flex-1 gap-2 p-2">
          <section className="flex min-h-0 w-[43%] min-w-[400px] max-w-[860px] flex-col gap-2 overflow-y-auto">
            <CallerRow caller={draft.caller} onChange={setCaller} readOnly={readOnly} />
            <AddressBlock
              address={draft.address}
              onChange={(a) => patch({ address: a })}
              readOnly={readOnly}
              okrugs={dir?.okrugs ?? []}
              districts={dir?.districts ?? []}
              onMap={() => notify("Карта в учебной версии не подключена: выберите адрес из подсказок, район и округ подставятся сами")}
            />
            <DescriptionBlock value={draft.description} onChange={(v) => patch({ description: v })} readOnly={readOnly} hints={Boolean(state.lesson?.hints)} />
          </section>
          <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto">
            <FlagsBar
              flags={draft.flags}
              onToggle={toggleFlag}
              readOnly={readOnly}
              typeChosen={draft.cards.length > 0}
              onEmpty={(reason) => setModal({ empty: reason })}
            />
            <TypeBlock
              cards={draft.cards}
              answers={draft.answers}
              readOnly={readOnly}
              onCards={(c, a) => patch({ cards: c, answers: a })}
            />
            {saved && (
              <div className="shrink-0 border-l-4 border-arm-blue bg-white px-4 py-3 text-[14px]">
                Карточка зарегистрирована и ушла в службы ({incident.plates.length}). Когда закончите — нажмите «отработана» (Alt+S): откроется разбор.
              </div>
            )}
          </section>
        </main>
        <ChatPanel
          call={call}
          lines={lines}
          pending={pending}
          now={now}
          hints={Boolean(state.lesson?.hints)}
          cards={draft.cards}
          onSend={say}
          onHangup={hangup}
        />
      </div>
      <ServicesBar
        plates={plates}
        saved={saved}
        disabled={readOnly || busy}
        important={important}
        onAdd={() => setModal("add")}
        onRemove={(id) => setManual(draft.manualServiceIds.filter((x) => x !== id))}
        onSave={() => setModal("notify")}
        onWorked={worked}
        onImportant={toggleImportant}
        onNotAvailable={(what) => notify(`${what}: в учебной версии не используется`)}
      />
      {modal === "add" && dir && (
        <AddServicesModal
          services={dir.services}
          autoIds={autoPlates.map((a) => a.serviceId)}
          manualIds={draft.manualServiceIds}
          onClose={() => setModal(null)}
          onSave={(ids) => {
            setManual(ids.filter((id) => !autoPlates.some((a) => a.serviceId === id)));
            setModal(null);
          }}
        />
      )}
      {modal === "notify" && <NotifyModal plates={plates} warnings={warnings} busy={busy} onConfirm={save} onBack={() => setModal(null)} />}
      {modal && typeof modal === "object" && (
        <EmptyCardModal reason={modal.empty} busy={busy} onConfirm={() => saveEmpty(modal.empty)} onBack={() => setModal(null)} />
      )}
    </>
  );
}
