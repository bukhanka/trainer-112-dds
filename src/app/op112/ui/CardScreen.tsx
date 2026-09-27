"use client";
import { useEffect, useState } from "react";
import useSWR from "swr";
import type { IncidentAddress, IncidentCaller } from "@/lib/incident/types";
import type { CallDto, IncidentDto, Op112State, ServiceCallDto } from "@/lib/op112/state";
import { addressFilled } from "@/lib/op112/card";
import { kindTitle } from "@/lib/op112/catalog";
import type { CallLine, Op112CardDraft, RoutedService } from "@/lib/op112/types";
import { openForSupplement } from "@/lib/op112/supplement";
import { phoneNotices, type WorkOff } from "@/lib/op112/workoffs";
import { ApiError, getJson, send, useNow, type StateWithClock } from "./client";
import { TopBar } from "./TopBar";
import { AddressBlock, AddressSummary, CallerRow, DescriptionBlock } from "./LeftColumn";
import { FlagsBar, TypeBlock } from "./RightColumn";
import { AddServicesModal, EmptyCardModal, NotifyModal, PhoneWarnModal, ServicesBar, type Plate, type ServiceItem } from "./Services";
import { ChatPanel } from "./ChatPanel";
import { EMPTY_ROW, WorkOffs, type WorkOffDraft } from "./WorkOffs";
import { dateTime, hhmm, mmss } from "./format";
import type { Notify } from "./Workstation";

type Directory = { services: ServiceItem[]; okrugs: string[]; districts: { okrug: string; district: string }[] };
type PhoneMissing = { name: string; reason: "call" | "record" };
type ModalState = null | "add" | "notify" | { empty: "noContact" | "dropped" } | { phone: PhoneMissing[] };
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

/** Alt+Y and Alt+N of a saved card are options of the status «Проверена» (the instruction's table). */
const NOT_CHECKED = (what: string) =>
  `${what} — кнопка карточки в статусе «Проверена», её ставит проверка; у этой карточки статус «Зарегистрирована»`;

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
  refresh: () => void;
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
  const [classes, setClasses] = useState<string[]>([]);
  const [lastSave, setLastSave] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalState>(null);
  const [busy, setBusy] = useState(false);
  const [important, setImportant] = useState(incident.important);
  // Work-offs of the saved card: the journal, the row being filled, the calls to services and the one in the chat.
  const [workLog, setWorkLog] = useState<WorkOff[]>(incident.workLog);
  const [row, setRow] = useState<WorkOffDraft>(EMPTY_ROW);
  const [svcCalls, setSvcCalls] = useState<ServiceCallDto[]>(incident.serviceCalls);
  const [chatWith, setChatWith] = useState<string>(() => incident.serviceCalls.at(-1)?.id ?? "caller");
  const [svcPending, setSvcPending] = useState(false);
  // A saved card: «Просмотр» (Shift+F1) or «Дополнить» (Shift+F2) — fields empty at saving, the description, victims.
  const [mode, setMode] = useState<"view" | "supplement">("view");
  const supplementing = saved && mode === "supplement";
  const { data: dir } = useSWR<Directory>("/api/op112/services", getJson, { revalidateOnFocus: false });
  const tick = useNow();
  const now = tick ? tick + state.clockOffset : Date.parse(state.serverNow);

  // Autosave of the draft, so a reload or a teacher's screen sees the card as it is being filled.
  const { refresh } = p;
  useEffect(() => {
    if (readOnly) return;
    const t = setTimeout(() => {
      send<{ savedAt: string }>(`/api/op112/incidents/${incident.id}`, { draft }, "PATCH")
        .then((r) => setLastSave(r.savedAt))
        .catch((e) => {
          // The card was saved or closed elsewhere (another tab): show it as it is now.
          if (e instanceof ApiError && e.status === 409) refresh();
        });
    }, 700);
    return () => clearTimeout(t);
  }, [draft, readOnly, incident.id, refresh]);

  // Plates picked by the system for the card as it is now.
  const { cards, answers, flags, address } = draft;
  useEffect(() => {
    if (readOnly) return;
    const t = setTimeout(() => {
      send<{ services: RoutedService[]; classes: string[] }>("/api/op112/route-preview", { cards, answers, flags, address })
        .then((r) => {
          setAutoPlates(r.services);
          setClasses(r.classes);
        })
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
    ? incident.plates.map((pl) => ({ ...pl, phoneOnly: byId.get(pl.serviceId)?.phoneOnly }))
    : [
        ...autoPlates.map((r) => ({
          serviceId: r.serviceId,
          shortName: byId.get(r.serviceId)?.shortName ?? `#${r.serviceId}`,
          fullName: byId.get(r.serviceId)?.fullName,
          isMain: r.isMain,
          auto: true,
          phoneOnly: byId.get(r.serviceId)?.phoneOnly,
        })),
        ...draft.manualServiceIds
          .filter((id) => !autoPlates.some((a) => a.serviceId === id))
          .map((id) => ({
            serviceId: id,
            shortName: byId.get(id)?.shortName ?? `#${id}`,
            fullName: byId.get(id)?.fullName,
            isMain: false,
            auto: false,
            phoneOnly: byId.get(id)?.phoneOnly,
          })),
      ];

  const phoneOnly = saved ? plates.filter((pl) => pl.phoneOnly).map((pl) => ({ serviceId: pl.serviceId, name: pl.shortName })) : [];
  const notices = phoneNotices(
    phoneOnly,
    svcCalls.map((c) => ({ id: c.id, serviceId: c.serviceId, duty: c.duty, at: c.startedAt, messages: c.messages })),
    workLog,
  );
  const svcCall = chatWith === "caller" ? null : (svcCalls.find((c) => c.id === chatWith) ?? null);
  const svcActive = svcCalls.find((c) => c.status === "ACTIVE") ?? null;

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
      // The caller hung up or the line broke: the conversation is over, the card stays open.
      if (r.status !== "ACTIVE") setCall((c) => (c ? { ...c, status: "ENDED", endedAt: c.endedAt ?? new Date().toISOString() } : c));
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

  const worked = async (confirm = false) => {
    setBusy(true);
    try {
      const s = await send<Op112State>(`/api/op112/incidents/${incident.id}/worked`, confirm ? { confirm: true } : undefined);
      p.onClosed(incident.id, incident.number);
      p.apply(s);
    } catch (e) {
      // A service that gets cards only by phone is not notified yet: warn once, the operator decides.
      if (e instanceof ApiError && e.code === "phone_not_notified") setModal({ phone: (e.data?.missing ?? []) as PhoneMissing[] });
      else notify("Не удалось закрыть карточку");
      setBusy(false);
    }
  };

  // ─── Work-offs: calls to services after «сохранить» ───
  const dial = async (serviceId: number) => {
    if (svcActive) {
      notify("Сначала завершите текущий разговор");
      return;
    }
    setBusy(true);
    try {
      const r = await send<{ call: ServiceCallDto }>(`/api/op112/incidents/${incident.id}/workoffs/call`, { serviceId });
      setSvcCalls((list) => [...list, r.call]);
      setChatWith(r.call.id);
      const phone = dir?.services.find((x) => x.id === serviceId)?.phone ?? "";
      setRow((x) => (x.serviceId === serviceId ? { ...x, callId: r.call.id, phone: x.phone || phone } : { ...EMPTY_ROW, serviceId, phone, callId: r.call.id }));
      setTimeout(() => document.getElementById("op112-chat")?.focus(), 50);
    } catch (e) {
      notify(e instanceof ApiError && e.code === "card_not_saved" ? "Звонить из отработки можно только по сохранённой карточке" : "Не удалось позвонить в службу");
    } finally {
      setBusy(false);
    }
  };

  const patchSvc = (id: string, f: (c: ServiceCallDto) => ServiceCallDto) => setSvcCalls((list) => list.map((c) => (c.id === id ? f(c) : c)));
  const endSvc = (c: ServiceCallDto) => ({ ...c, status: "ENDED" as const, endedAt: c.endedAt ?? new Date().toISOString() });

  const saySvc = async (text: string) => {
    const c = svcCall;
    if (!c || c.status !== "ACTIVE") return;
    patchSvc(c.id, (x) => ({ ...x, messages: [...x.messages, { role: "trainee", text, at: new Date().toISOString() }] }));
    setSvcPending(true);
    try {
      const r = await send<{ lines: CallLine[]; status: string }>(`/api/op112/service-calls/${c.id}/messages`, { text });
      patchSvc(c.id, (x) => {
        const next = { ...x, messages: [...x.messages, ...r.lines.filter((l) => l.role === "counterpart")] };
        return r.status !== "ACTIVE" ? endSvc(next) : next;
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === "call_not_active") patchSvc(c.id, endSvc);
      else notify("Служба не расслышала — повторите");
    } finally {
      setSvcPending(false);
    }
  };

  const hangupSvc = async () => {
    const c = svcActive;
    if (!c) return;
    patchSvc(c.id, endSvc);
    await send(`/api/op112/service-calls/${c.id}/hangup`).catch(() => undefined);
    // Next: write down who took the card.
    setTimeout(() => document.getElementById("op112-workoff-person")?.focus(), 50);
  };

  const saveRow = async () => {
    setBusy(true);
    try {
      const r = await send<{ workLog: WorkOff[] }>(`/api/op112/incidents/${incident.id}/workoffs`, {
        serviceId: row.serviceId ?? undefined,
        where: row.where,
        phone: row.phone,
        acceptedBy: row.acceptedBy,
        summary: row.summary,
        callId: row.callId ?? undefined,
      });
      setWorkLog(r.workLog);
      setRow(EMPTY_ROW);
    } catch {
      notify("Отработка не сохранилась — попробуйте ещё раз");
    } finally {
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

  const toView = () => {
    // Leaving «Дополнить» without «сохранить» drops what was typed.
    if (mode === "supplement") setDraft({ ...incident.draft, manualServiceIds: [] });
    setMode("view");
  };
  const toSupplement = () => {
    setMode("supplement");
    setTimeout(() => focusById("op112-description"), 50);
  };
  const saveSupplement = async () => {
    setBusy(true);
    try {
      const s = await send<Op112State>(`/api/op112/incidents/${incident.id}/supplement`, { draft });
      setMode("view");
      p.apply(s);
      notify("Дополнение сохранено: оно записано в журнал описаний карточки");
    } catch {
      notify("Дополнение не сохранилось — попробуйте ещё раз");
    } finally {
      setBusy(false);
    }
  };
  const openCaller = (f: keyof IncidentCaller) => supplementing && openForSupplement(incident.draft.caller[f]);
  const openAddress = (f: keyof IncidentAddress) => supplementing && openForSupplement(incident.draft.address[f]);

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
      // Shift+F1 / Shift+F2: the menu items of a saved card, «Просмотр» and «Дополнить».
      if (e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && (e.code === "F1" || e.code === "F2")) {
        if (!saved || modal) return;
        e.preventDefault();
        switch (`Shift+${e.code}`) {
          case "Shift+F1":
            toView();
            break;
          case "Shift+F2":
            toSupplement();
            break;
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
            if (!readOnly || supplementing) toggleFlag("victims");
            break;
          case "KeyN":
            // Creating: to the «нет контакта / срыв звонка» block. Viewing: «Вернуть на доработку» of a «Проверена» card.
            if (saved) notify(NOT_CHECKED("«Вернуть на доработку» (Alt+N)"));
            else if (readOnly) break;
            else if (draft.cards.length) notify("«Нет контакта» и «срыв звонка» работают, пока не выбран тип происшествия");
            else focusById("op112-nocontact");
            break;
          case "KeyY":
            if (saved) notify(NOT_CHECKED("«Проверена» (Alt+Y)"));
            break;
          case "KeyT":
            focusById("op112-type");
            break;
          case "KeyR":
            focusById("op112-significant");
            break;
          case "KeyO":
            // Creating (and supplementing): the description. Viewing a saved card: the work-offs.
            if (saved && !supplementing) focusById("op112-workoff-service");
            else focusById("op112-description");
            break;
          case "KeyZ":
            if (!readOnly) setModal("add");
            break;
          case "KeyS":
            if (modal === "notify") void save();
            else if (!modal) {
              if (supplementing) void saveSupplement();
              else if (saved) void worked();
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
  const svcSec = svcActive?.answeredAt ? (now - Date.parse(svcActive.answeredAt)) / 1000 : 0;
  const telephony = talking
    ? { label: `Разговор ${mmss(talkSec)}`, tone: "talk" as const }
    : svcActive
      ? { label: `${svcActive.service} ${mmss(svcSec)}`, tone: "talk" as const }
      : { label: "Недоступен", tone: "busy" as const };
  const savedLabel = incident.savedAt ? dateTime(incident.savedAt) : lastSave ? dateTime(lastSave) : null;

  return (
    <>
      <TopBar
        telephony={telephony}
        canHangup={talking || Boolean(svcActive)}
        onHangup={talking ? hangup : hangupSvc}
        caller={draft.caller}
        onCaller={setCaller}
        editable={!readOnly}
        phoneEditable={(f) => openCaller(f)}
        incident={{ number: incident.number, savedLabel }}
        operatorNo={state.user.operatorNo}
        armNo={state.seat?.armNo ?? "1"}
        timer={{ sec: typingSec, late: typingSec > limit, running: !incident.savedAt }}
        onNotAvailable={(what) => notify(`${what}: в учебной версии не используется`)}
        viewMenu={saved ? { supplementing, busy, onView: toView, onSupplement: toSupplement } : undefined}
      />
      <div className="flex min-h-0 flex-1">
        <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-2">
          <div className="flex min-h-0 flex-1 gap-2">
            <section className="flex min-h-0 w-[43%] min-w-[400px] max-w-[860px] flex-col gap-2 overflow-y-auto">
              <CallerRow caller={draft.caller} onChange={setCaller} readOnly={readOnly} editable={supplementing ? openCaller : undefined} />
              {saved && !supplementing ? (
                <AddressSummary address={draft.address} onMap={() => notify("Карта в учебной версии не подключена")} />
              ) : (
                <AddressBlock
                  address={draft.address}
                  onChange={(a) => patch({ address: a })}
                  readOnly={readOnly}
                  okrugs={dir?.okrugs ?? []}
                  districts={dir?.districts ?? []}
                  onMap={() => notify("Карта в учебной версии не подключена: выберите адрес из подсказок, район и округ подставятся сами")}
                  editable={supplementing ? openAddress : undefined}
                />
              )}
              <DescriptionBlock
                value={draft.description}
                onChange={(v) => patch({ description: v })}
                readOnly={readOnly && !supplementing}
                hints={Boolean(state.lesson?.hints)}
                hk={saved && !supplementing ? undefined : "Alt+O"}
              />
            </section>
            <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto">
              <FlagsBar
                flags={draft.flags}
                onToggle={toggleFlag}
                readOnly={readOnly}
                victimsEditable={supplementing}
                typeChosen={draft.cards.length > 0}
                onEmpty={(reason) => setModal({ empty: reason })}
              />
              <TypeBlock
                cards={draft.cards}
                answers={draft.answers}
                readOnly={readOnly}
                classes={classes}
                addressReady={addressFilled(draft.address)}
                onAddress={() => focusById("op112-address")}
                onCards={(c, a) => patch({ cards: c, answers: a })}
              />
              {supplementing && (
                <div className="shrink-0 border-l-4 border-arm-orange bg-white px-4 py-3 text-[14px]">
                  Дополнение: можно заполнить поля, пустые при сохранении, дописать описание и изменить «Пострадавшие». «сохранить» (Alt+S) запишет
                  дополнение в журнал описаний карточки — его увидят службы; «просмотр» (Shift+F1) — выйти без сохранения.
                </div>
              )}
              {saved && !supplementing && (
                <div className="shrink-0 border-l-4 border-arm-blue bg-white px-4 py-3 text-[14px]">
                  Карточка зарегистрирована и ушла в службы ({incident.plates.length}).
                  {phoneOnly.length > 0 && ` ${phoneOnly.map((x) => x.name).join(", ")} получает карточку только по телефону — позвоните из «Отработок» (Alt+O) и запишите, кто принял.`}{" "}
                  Когда закончите — нажмите «отработана» (Alt+S): откроется разбор.
                </div>
              )}
            </section>
          </div>
          {saved && (
            <WorkOffs
              log={workLog}
              notices={notices}
              plates={plates}
              services={dir?.services ?? []}
              row={row}
              onRow={setRow}
              activeCall={svcActive}
              busy={busy}
              onDial={dial}
              onSave={saveRow}
            />
          )}
        </main>
        {svcCall ? (
          <ChatPanel
            call={svcCall}
            lines={svcCall.messages}
            pending={svcPending}
            now={now}
            hints={false}
            cards={[]}
            title={`Звонок: ${svcCall.service}`}
            who="Служба"
            quick={serviceQuick(state.user.operatorNo, incident.number, draft, incident.classes)}
            tabs={<ChatTabs calls={svcCalls} current={chatWith} onPick={setChatWith} />}
            onSend={saySvc}
            onHangup={hangupSvc}
          />
        ) : (
          <ChatPanel
            call={call}
            lines={lines}
            pending={pending}
            now={now}
            hints={Boolean(state.lesson?.hints)}
            cards={draft.cards}
            tabs={svcCalls.length ? <ChatTabs calls={svcCalls} current={chatWith} onPick={setChatWith} /> : undefined}
            onSend={say}
            onHangup={hangup}
          />
        )}
      </div>
      <ServicesBar
        plates={plates}
        saved={saved}
        disabled={readOnly || busy}
        important={important}
        onAdd={() => setModal("add")}
        onRemove={(id) => setManual(draft.manualServiceIds.filter((x) => x !== id))}
        onSave={() => setModal("notify")}
        onWorked={() => void worked()}
        supplement={supplementing}
        onSupplementSave={() => void saveSupplement()}
        onDial={saved ? dial : undefined}
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
      {modal && typeof modal === "object" && "empty" in modal && (
        <EmptyCardModal reason={modal.empty} busy={busy} onConfirm={() => saveEmpty(modal.empty)} onBack={() => setModal(null)} />
      )}
      {modal && typeof modal === "object" && "phone" in modal && (
        <PhoneWarnModal
          missing={modal.phone}
          busy={busy}
          onBack={() => {
            setModal(null);
            setTimeout(() => focusById("op112-workoff-service"), 50);
          }}
          onConfirm={() => {
            setModal(null);
            void worked(true);
          }}
        />
      )}
    </>
  );
}

/** Everyday words for the kinds a dispatcher names on the phone («Происшествие 101» is a screen title, not words). */
const KIND_SAID: Record<string, string> = { "101": "пожар", "102": "правонарушение", "103": "нужна скорая помощь", "104": "утечка газа" };

/** Ready phrases for a call to a service: what the duty needs — the card number, what happened and where. */
function serviceQuick(operatorNo: string, number: number, draft: Op112CardDraft, classes: string[]): string[] {
  const where = [draft.address.street, draft.address.house && `дом ${draft.address.house}`].filter(Boolean).join(", ") || draft.address.descriptive || "";
  const what = classes.length ? classes.join("; ") : draft.cards.map((k) => KIND_SAID[k] ?? kindTitle(k)).join(", ");
  return [
    `Служба 112, оператор ${operatorNo}. Примите карточку.`,
    `Карточка № ${number}.`,
    ...(what ? [`Что случилось: ${what}.`] : []),
    ...(where ? [`Адрес: ${where}.`] : []),
    "Спасибо, до связи.",
  ];
}

/** Which conversation the chat shows: the caller, or one of the calls from the work-off row. */
function ChatTabs(p: { calls: ServiceCallDto[]; current: string; onPick: (id: string) => void }) {
  const tab = (id: string, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => p.onPick(id)}
      aria-pressed={p.current === id}
      className={`shrink-0 border-b-2 px-2 py-1 text-[12px] ${p.current === id ? "border-arm-blue text-arm-dark" : "border-transparent text-arm-desc hover:text-arm-dark"}`}
    >
      {label}
    </button>
  );
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-[#dde1e3] bg-white px-2" role="group" aria-label="Разговоры">
      {tab("caller", "Заявитель")}
      {p.calls.map((c) => tab(c.id, `${c.service} ${hhmm(c.startedAt)}${c.status === "ACTIVE" ? " ●" : ""}`))}
    </div>
  );
}

