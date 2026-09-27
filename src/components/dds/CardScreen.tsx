"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import type { ServiceStatus } from "@prisma/client";
import { fmtDate, fmtDateTime, fmtDuration, fmtHM, dateParts, plateCaption, plateCaptionClass } from "@/lib/dds/format";
import type { CardView, PlateView } from "@/lib/dds/view";
import { getJson, postJson, useNow, withSeat } from "./client";
import { useDds } from "./DdsShell";
import { useSoftphone } from "./softphone-context";
import { Bolt, Chat, Check, ChevronDown, ChevronUp, Close, CollapseV, Exclaim, ExpandV, HandsetDown, Hourglass, MapPinOff, Pencil, Phone, Warning } from "./icons";

type OwnPlate = {
  plateId: string;
  status: ServiceStatus;
  crewNumber: string | null;
  noReject: boolean;
  editable: boolean;
  options: { value: ServiceStatus; label: string }[];
  addedAt: string;
  openedAt: string | null;
  recordAt: string | null;
};
type CardBody = { card: CardView; own: OwnPlate | null };

const ROW = 8; // plates in the bottom row; the rest go to the second row above it
const NO_CREW = "Завершение работ без бригады";

export function CardScreen({ number }: { number: number }) {
  const { state, seatParam, refresh } = useDds();
  const router = useRouter();
  const { data, error, mutate } = useSWR(withSeat(`/api/dds/incidents/${number}`, seatParam), getJson<CardBody>, {
    refreshInterval: 1500,
    dedupingInterval: 500,
  });
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [expandedChoice, setExpandedChoice] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const back = () => router.push(withSeat("/dds", seatParam));

  if (error && !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-arm-gray text-arm-dark">
        <p>{error.message}</p>
        <button onClick={back} className="bg-arm-dark px-3 py-1 text-white">
          К списку происшествий
        </button>
      </div>
    );
  }
  if (!data) return <div className="flex min-h-screen items-center justify-center bg-arm-gray text-arm-dark">Загрузка карточки…</div>;

  const { card, own } = data;
  const ownIndex = card.plates.findIndex((p) => p.own);
  const lower = card.plates.slice(0, ROW);
  const upper = card.plates.slice(ROW);
  const expanded = expandedChoice ?? ownIndex >= ROW;
  const showUpper = upper.length > 0 && expanded;

  const flash = (text: string) => {
    setNotice(text);
    setTimeout(() => setNotice(null), 3500);
  };

  return (
    <div className="flex min-h-screen flex-col bg-arm-gray pb-[140px] text-[#1f2326]">
      <TopStrip card={card} seatLabel={state.seat.serviceShort} own={own} />
      {state.seat.readOnly ? (
        <div className="mx-2 mb-2 bg-arm-dark px-3 py-1 text-[12px] text-white">Только просмотр: {state.seat.lessonTitle}</div>
      ) : null}

      <div className="flex flex-col gap-2 px-2 lg:flex-row">
        <LeftColumn card={card} />
        <RightColumn card={card} />
      </div>

      {editing && own ? (
        <StatusLine
          number={number}
          own={own}
          hints={state.seat.hints}
          lifted={showUpper}
          onCancel={() => setEditing(false)}
          onSaved={(closed) => {
            setEditing(false);
            void mutate();
            refresh();
            if (closed) flash("Карточка закрыта для вашей службы: статусы больше не меняются.");
          }}
        />
      ) : null}

      {notice ? (
        <div className="fixed left-1/2 top-4 z-40 -translate-x-1/2 bg-arm-dark px-4 py-2 text-[13px] text-white shadow-lg">{notice}</div>
      ) : null}

      <footer className="fixed inset-x-0 bottom-0 z-20 flex h-[64px] items-stretch bg-arm-desc text-white">
        <div className="flex items-center px-2 text-[12px]">Службы:</div>
        <div className="relative flex min-w-0 flex-1 items-stretch">
          {showUpper ? (
            <div className="absolute bottom-full left-0 flex h-[64px] items-stretch bg-arm-desc/95">
              {upper.map((p) => (
                <Plate
                  key={p.id}
                  plate={p}
                  open={historyFor === p.id}
                  editing={editing}
                  editable={!!own?.editable && p.own}
                  onToggle={() => setHistoryFor((h) => (h === p.id ? null : p.id))}
                  onEdit={() => setEditing(true)}
                />
              ))}
            </div>
          ) : null}
          <div className="flex min-w-0 items-stretch overflow-visible">
            {lower.map((p) => (
              <Plate
                key={p.id}
                plate={p}
                open={historyFor === p.id}
                editing={editing}
                editable={!!own?.editable && p.own}
                onToggle={() => setHistoryFor((h) => (h === p.id ? null : p.id))}
                onEdit={() => setEditing(true)}
              />
            ))}
          </div>
          {upper.length ? (
            <div className="flex items-center px-3">
              <button
                onClick={() => setExpandedChoice(!expanded)}
                aria-label={expanded ? "Свернуть второй ряд служб" : "Развернуть второй ряд служб"}
                className="grid h-10 w-10 place-items-center border border-white/50 hover:bg-white/10"
              >
                {expanded ? <CollapseV className="h-5 w-5" /> : <ExpandV className="h-5 w-5" />}
              </button>
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2 px-2">
          <span title="Сообщить о проблеме" className="grid h-10 w-10 place-items-center border border-white/30 bg-white/5">
            <Exclaim className="h-6 w-6" />
          </span>
          <button onClick={back} aria-label="Закрыть карточку" className="grid h-10 w-10 place-items-center border border-white/50 hover:bg-white/10">
            <Close className="h-6 w-6" />
          </button>
        </div>
      </footer>
    </div>
  );
}

function TopStrip({ card, seatLabel, own }: { card: CardView; seatLabel: string; own: OwnPlate | null }) {
  const saved = dateParts(card.savedAt);
  return (
    <div className="flex flex-wrap gap-2 p-2 lg:flex-nowrap">
      <div className="flex h-[64px] w-full items-center gap-4 bg-arm-panel px-4 sm:w-[270px]">
        <HandsetDown className="h-8 w-8 shrink-0 text-arm-dark" />
        <div>
          <div className="text-[13px]">Отключение</div>
          <div className="mt-1.5 flex gap-2">
            <span className="bg-[#b5b9bc] px-3 py-0.5 text-[9px] text-white">записи звонков</span>
            <span className="border border-arm-dark/50 px-3 py-0.5 text-[9px]">список SMS</span>
          </div>
        </div>
      </div>
      <PhoneField label="АОН" value={card.caller.aon} incidentId={card.id} />
      <PhoneField label="предоставленный" value={card.caller.provided} incidentId={card.id} />
      <PhoneField label="телефон на место" value={card.caller.onSite} incidentId={card.id} />
      <div className="flex h-[64px] min-w-[200px] flex-col justify-center bg-arm-panel px-2 text-[11px] leading-4">
        <div className="text-[15px] font-bold leading-5">Происшествие {card.number}</div>
        <div>
          Сохр. {fmtDate(card.savedAt)} в {saved.HH}:{saved.MM}:{saved.SS}
        </div>
        <div className="truncate">
          Опер. {card.operatorNo}, АРМ {card.armNo}, {seatLabel}
        </div>
      </div>
      {own ? <OwnTimer own={own} /> : null}
      <div className="flex h-[64px] w-[96px] shrink-0 flex-col gap-1">
        <span className="grid flex-1 place-items-center bg-arm-blue text-[10px] text-white">просмотр</span>
        <span className="grid flex-1 place-items-center bg-arm-dark text-[10px] text-white">дополнение</span>
      </div>
    </div>
  );
}

/**
 * The 3-minute norm of the own plate in the style of the feed's timer (customer's answer of 27.09): from
 * «Добавлена» to the first record — a status with a text; counts down, red when late. The card is open here,
 * so the 30 seconds to open it are already behind.
 */
function OwnTimer({ own }: { own: OwnPlate }) {
  const { state, offset } = useDds();
  const now = useNow(offset);
  const { workSec, lessonStatus } = state.seat;
  if (lessonStatus !== "RUNNING" || own.recordAt || !own.editable) return null;
  const left = now ? workSec - (now - Date.parse(own.addedAt)) / 1000 : workSec;
  const late = left < 0;
  return (
    <div
      role="timer"
      title={`Первая запись — статус и текст — в течение ${fmtDuration(workSec)} от «Добавлена». Статус без текста запись не закрывает`}
      className={`flex h-[64px] w-[124px] shrink-0 flex-col items-center justify-center text-white ${late ? "bg-arm-late" : "bg-arm-dark"}`}
    >
      <span className="flex items-center gap-1 text-[24px] font-bold leading-none tabular-nums">
        <Hourglass className="h-5 w-5" />
        {late ? `+${fmtDuration(-left)}` : fmtDuration(left)}
      </span>
      <span className="mt-1 text-[10px] font-semibold">{late ? "запись опаздывает" : "на первую запись"}</span>
    </div>
  );
}

function PhoneField({ label, value, incidentId }: { label: string; value?: string; incidentId: string }) {
  const phone = useSoftphone();
  return (
    <div className="flex h-[64px] min-w-[180px] flex-1 gap-1">
      <div className="flex w-7 flex-col items-center justify-around bg-arm-gray">
        <button
          disabled={!value || !phone.canDial}
          onClick={() => value && phone.dial(value, { incidentId })}
          title={value ? `Позвонить: ${value}` : "Номера нет"}
          className="text-arm-dark/80 hover:text-arm-blue disabled:opacity-40"
        >
          <Phone className="h-5 w-5" />
        </button>
        <Chat className="h-4 w-4 text-arm-dark/60" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col bg-arm-panel px-2 py-1">
        <span className="text-[10px] text-arm-desc">{label}</span>
        <span className="truncate text-[20px] text-arm-desc">{value ?? ""}</span>
      </div>
    </div>
  );
}

function LeftColumn({ card }: { card: CardView }) {
  return (
    <section className="flex w-full flex-col gap-2 lg:w-[47%]">
      <div className="bg-arm-panel px-2 py-2">
        <div className="text-[9px] text-arm-desc">ФИО заявителя</div>
        <div className="text-[14px]">
          {card.caller.fullName ?? ""} <span className="text-arm-desc">{card.caller.status ?? ""}</span>
        </div>
      </div>
      <div className="relative bg-arm-panel px-2 py-2 pr-8 text-[13px]">
        <div className="font-bold">{card.addressTitle}</div>
        <div>{card.addressSecond}</div>
        <MapPinOff className="absolute right-3 top-3 h-4 w-4 text-arm-dark" />
      </div>
      <div className="min-h-[360px] overflow-y-auto bg-arm-panel px-3 py-3 text-[13px]">
        {card.descriptionLog.map((e, i) => (
          <div key={i} className="mb-3">
            <div className="font-bold">
              {e.at ? fmtDateTime(e.at) : ""} &nbsp; {e.author}
            </div>
            <div className="whitespace-pre-wrap">{e.text}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

const yesNo = (v: boolean) => (v ? "есть" : "нет");

function RightColumn({ card }: { card: CardView }) {
  return (
    <section className="flex min-w-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <div className="flex flex-1 flex-wrap items-center gap-x-3 bg-arm-panel px-2 py-2 text-[13px]">
          <span>Пострадавшие: {yesNo(card.flags.victims)}</span>
          <span>Отказ от скорой: {yesNo(card.flags.refusedAmbulance)}</span>
          <span>Заблокированные: {yesNo(card.flags.blocked)}</span>
        </div>
        <div className="flex items-center gap-3 bg-arm-panel px-2 py-1.5">
          <span className={`flex items-center gap-1 border border-arm-dark/40 px-1.5 py-0.5 text-[12px] ${card.important ? "bg-yellow-200" : "bg-white"}`}>
            ЧС <Bolt className="h-3.5 w-3.5" />
          </span>
          <span className="flex items-center gap-1 bg-arm-orange px-1.5 py-0.5 text-[12px] text-white">
            ЧП <Warning className="h-3.5 w-3.5" />
          </span>
          <span className="rounded-full border-2 border-arm-dark/70 p-1">
            <Pencil className="h-3 w-3" />
          </span>
        </div>
      </div>
      <div className="bg-arm-dark px-3 py-1 text-[13px] font-bold text-white">
        <span className="border-b border-dashed border-white/80">Происшествие {card.cardType}</span>
      </div>
      <div className="bg-arm-panel px-3 py-2 text-[13px] font-bold">{card.tagsLine || " "}</div>
      <div className="bg-arm-panel px-3 py-2 text-[13px]">
        Класс.: <b>{card.classLine}</b>
      </div>
      <div className="bg-arm-panel px-3 py-2 text-[13px]">[ВИС] Класс.:</div>
    </section>
  );
}

function Plate(props: { plate: PlateView; open: boolean; editing: boolean; editable: boolean; onToggle: () => void; onEdit: () => void }) {
  const { plate, open, editable } = props;
  const grey = plate.delivery === "PHONE";
  // Own plate turns blue while its history or its status line is open, as on the screenshots.
  const bg = open || (plate.own && props.editing) ? "bg-arm-blue" : grey ? "bg-arm-plate-gray" : "bg-arm-desc";
  const caption = plateCaption(plate.shortName);
  return (
    <div className={`relative flex w-[104px] shrink-0 flex-col items-center justify-center border-r border-[#3c464d] px-1 ${bg}`}>
      <button onClick={props.onToggle} aria-label={`История статусов: ${plate.fullName}`} className="leading-none text-white/90 hover:text-white">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />}
      </button>
      {plate.own && editable ? (
        <button onClick={props.onEdit} aria-label="Поставить статус своей службы" title="Поставить статус" className="absolute right-1 top-1 text-white hover:text-yellow-200">
          <Pencil className="h-3.5 w-3.5" />
        </button>
      ) : null}
      {plate.vis ? <span className="absolute left-1 top-0.5 text-[8px] font-bold">ВИС</span> : null}
      <button onClick={props.onToggle} className="mt-0.5 w-full" title={plate.fullName === plate.shortName ? plate.shortName : `${plate.shortName} — ${plate.fullName}`}>
        <span className={`line-clamp-2 break-words text-center font-bold leading-[1.1] ${plateCaptionClass(caption)} ${plate.main ? "underline" : ""}`}>{caption}</span>
      </button>
      <div className="w-full truncate text-center text-[10px]" title={`${fmtHM(plate.lastAt)} ${plate.label}`}>
        <span className={plate.lastLate ? "font-bold text-arm-late" : ""}>{fmtHM(plate.lastAt)}</span> {plate.label}
      </div>
      {open ? <HistoryPopup plate={plate} onClose={props.onToggle} /> : null}
    </div>
  );
}

function HistoryPopup({ plate, onClose }: { plate: PlateView; onClose: () => void }) {
  return (
    <div className="absolute bottom-full left-0 z-30 max-h-[50vh] w-[min(560px,92vw)] overflow-y-auto bg-arm-blue text-[12px] text-white shadow-xl">
      <div className="sticky top-0 flex items-center justify-between bg-arm-blue px-2 py-1.5 text-[13px]">
        <span title={plate.fullName}>{plate.shortName}</span>
        <button onClick={onClose} aria-label="Закрыть историю">
          <Close className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="px-1 pb-2">
        {plate.history.map((h) => (
          <div key={h.id} className="grid grid-cols-[84px_minmax(210px,auto)_1fr] items-start gap-1 py-0.5">
            <span className="truncate" title={h.actor}>
              {h.actor}
            </span>
            <span className="flex gap-1">
              <span>›</span>
              <span className={h.late ? "font-bold text-[#ff3030] [text-shadow:0_0_1px_#fff]" : ""} title={h.late ? "Поставлен с опозданием" : undefined}>
                {fmtDateTime(h.at)}
              </span>
              <span>{h.label}</span>
              {h.crewNumber && (h.status === "ACCEPTED" || h.status === "STARTED") ? <span className="text-white/75">(наряд {h.crewNumber})</span> : null}
            </span>
            <span className="flex gap-1">
              {h.comment ? (
                <>
                  <span>›</span>
                  <span>{h.comment}</span>
                </>
              ) : null}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const HINTS: Partial<Record<ServiceStatus, string>> = {
  ACCEPTED: "Принята — реагирование будет. В «Номер наряда» — кого отправили; в комментарий — что делаете: статус без текста первой записью не считается.",
  REJECTED: "Не принята — обязательно: причина и кому передали (организация, «передано», «дубль», «КП №»).",
  STARTED: "Ставится по докладу старшего наряда о выезде. Комментарий — что делают.",
  ARRIVED: "Ставится по докладу о прибытии на место.",
  WORKING: "Ставится по докладу о начале работ.",
  FINISHED: "Все итоги — в комментарий: после сохранения карточка закроется для вашей службы.",
  REFUSED: "Причина и кому передали. После сохранения карточка закроется.",
};

function StatusLine(props: {
  number: number;
  own: OwnPlate;
  hints: boolean;
  lifted: boolean;
  onCancel: () => void;
  onSaved: (closed: boolean) => void;
}) {
  const { own } = props;
  const { seatParam } = useDds();
  const phone = useSoftphone();
  const [status, setStatus] = useState<ServiceStatus | "">("");
  const [crew, setCrew] = useState(own.crewNumber ?? "");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const primary = own.status === "ADDED" || own.status === "RECEIVED";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!status) {
      setError("Выберите статус");
      return;
    }
    setBusy(true);
    const res = await postJson<{ status: ServiceStatus }>(withSeat(`/api/dds/incidents/${props.number}/status`, seatParam), {
      status,
      crewNumber: crew,
      comment,
    });
    setBusy(false);
    if (!res.ok) setError(res.message);
    else props.onSaved(status === "FINISHED" || status === "REFUSED");
  }

  const hint =
    status === "FINISHED" && own.noReject && primary ? `Служба 103 вместо «Не принята» ставит «Работы завершены: ${NO_CREW}».` : status ? HINTS[status] : null;
  const bottom = props.lifted ? "bottom-[132px]" : "bottom-[68px]";

  return (
    <>
      {/* Above the softphone button (z-30): the ✓ of the status row sits in the same bottom-right corner. */}
      <div className="fixed inset-x-0 top-0 bottom-[64px] z-[35] bg-black/35" onClick={props.onCancel} />
      <div className={`fixed left-2 right-2 z-40 sm:left-[120px] sm:right-auto sm:w-[min(1060px,calc(100vw-140px))] ${bottom}`}>
        {error ? <div className="mb-1 border border-arm-late bg-[#fff1f0] px-3 py-1 text-[13px] text-arm-late">{error}</div> : null}
        {props.hints && hint ? <div className="mb-1 bg-arm-dark/90 px-3 py-1 text-[12px] text-white">{hint}</div> : null}
        <form
          onSubmit={submit}
          onKeyDown={(e) => e.key === "Escape" && props.onCancel()}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-white px-2 py-1 shadow-lg sm:flex-nowrap"
        >
          <select
            autoFocus
            value={status}
            onChange={(e) => {
              const next = e.target.value as ServiceStatus | "";
              setStatus(next);
              setError(null);
              if (next === "FINISHED" && own.noReject && primary && !comment) setComment(NO_CREW);
            }}
            aria-label="Статус"
            className="w-full border-b border-arm-dark/40 bg-white py-1 text-[13px] outline-none sm:w-[300px]"
          >
            <option value="">Статус</option>
            {own.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <input
            value={crew}
            onChange={(e) => setCrew(e.target.value)}
            placeholder="Номер наряда"
            aria-label="Номер наряда"
            list="dds-crews"
            className="w-full border-b border-arm-dark/40 py-1 text-[13px] outline-none sm:w-[310px]"
          />
          <datalist id="dds-crews">
            {phone.crews.map((c) => (
              <option key={c.crew} value={c.crew}>
                {c.title}, старший {c.leader}
              </option>
            ))}
          </datalist>
          <input
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Комментарий"
            aria-label="Комментарий"
            maxLength={1000}
            className="w-full flex-1 border-b border-arm-dark/40 py-1 text-[13px] outline-none sm:w-auto"
          />
          <button type="submit" disabled={busy} aria-label="Сохранить статус" className="grid h-7 w-7 place-items-center border border-arm-dark/30 text-arm-dark hover:bg-arm-panel disabled:opacity-50">
            <Check className="h-4 w-4" />
          </button>
          <button type="button" onClick={props.onCancel} aria-label="Отмена" className="grid h-7 w-7 place-items-center border border-arm-dark/30 text-arm-dark hover:bg-arm-panel">
            <Close className="h-4 w-4" />
          </button>
        </form>
      </div>
    </>
  );
}
