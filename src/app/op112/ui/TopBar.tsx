"use client";
import type { IncidentCaller } from "@/lib/incident/types";
import { IconGlobe, IconHangup, IconPhone, IconPin, IconQuestion, IconSms } from "./icons";
import { dateTime, formatPhone, mmss } from "./format";

export type Telephony = { label: string; tone: "ok" | "busy" | "ring" | "talk" | "off" };

type Props = {
  telephony: Telephony;
  canHangup: boolean;
  onHangup: () => void;
  caller: IncidentCaller | null;
  onCaller: (patch: Partial<IncidentCaller>) => void;
  editable: boolean;
  /** «Дополнить»: a phone left empty at saving can still be filled */
  phoneEditable?: (field: "provided" | "onSite") => boolean;
  incident: { number: number; savedLabel: string | null } | null;
  operatorNo: string;
  armNo: string;
  timer: { sec: number; late: boolean; running: boolean } | null;
  onNotAvailable: (what: string) => void;
  /** A saved card: «просмотр» (Shift+F1) and «дополнение» (Shift+F2) at the top right, as on the workstation. */
  viewMenu?: { supplementing: boolean; busy: boolean; onView: () => void; onSupplement: () => void };
};

const TONE: Record<Telephony["tone"], string> = {
  ok: "text-[#1c8a3a]",
  busy: "text-arm-dark",
  ring: "text-arm-blue",
  talk: "text-arm-blue",
  off: "text-arm-dark",
};

export function TopBar(p: Props) {
  return (
    <header className="flex h-[84px] shrink-0 items-stretch gap-2 bg-arm-gray px-2 pt-2 text-arm-dark">
      <div className="flex min-w-0 flex-1 items-stretch bg-white">
        <button
          type="button"
          onClick={p.onHangup}
          disabled={!p.canHangup}
          title="Сбросить вызов"
          className="flex w-[70px] shrink-0 items-center justify-center border-r border-arm-gray text-arm-dark enabled:hover:text-arm-late disabled:opacity-40"
        >
          <IconHangup className="h-8 w-8" />
        </button>
        <div className="flex w-[196px] shrink-0 flex-col justify-center gap-1.5 border-r border-arm-gray px-2.5">
          <div className={`truncate text-[15px] ${TONE[p.telephony.tone]}`}>{p.telephony.label}</div>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => p.onNotAvailable("Записи звонков")} className="arm-mini-btn">
              записи звонков
            </button>
            <button type="button" onClick={() => p.onNotAvailable("Список SMS")} className="arm-mini-btn">
              список SMS
            </button>
          </div>
        </div>
        <PhoneBlock
          label="АОН"
          hk="Alt+F1"
          id="op112-aon"
          value={p.caller?.aon ?? ""}
          readOnly
          extraIcons={
            <>
              <a
                href="/help#op112"
                target="_blank"
                rel="noopener"
                aria-label="Справка: памятка оператора 112"
                title="Справка: порядок работы и горячие клавиши — откроется в новой вкладке"
                className="hover:text-arm-blue"
              >
                <IconQuestion className="h-3.5 w-3.5" />
              </a>
              <IconPin className="h-3.5 w-3.5" />
            </>
          }
        />
        <PhoneBlock
          label="предоставленный"
          hk="Alt+F2"
          id="op112-provided"
          value={p.caller?.provided ?? ""}
          readOnly={!(p.editable || p.phoneEditable?.("provided"))}
          onChange={(v) => p.onCaller({ provided: v })}
          onCopyAon={() => p.onCaller({ provided: p.caller?.aon ?? "" })}
        />
        <PhoneBlock
          label="телефон на место"
          hk="Alt+F3"
          id="op112-onsite"
          value={p.caller?.onSite ?? ""}
          readOnly={!(p.editable || p.phoneEditable?.("onSite"))}
          onChange={(v) => p.onCaller({ onSite: v })}
          onCopyAon={() => p.onCaller({ onSite: p.caller?.aon ?? "" })}
        />
      </div>
      <div
        className="flex w-[210px] shrink-0 flex-col justify-center bg-white px-3 leading-tight 2xl:w-[250px]"
        data-hk={p.viewMenu ? "Alt+Y · Alt+N" : undefined}
        title={p.viewMenu ? "Alt+Y «Проверена» и Alt+N «Вернуть на доработку» — для карточки в статусе «Проверена»" : undefined}
      >
        {p.incident ? (
          <>
            <div className="text-[15px] font-bold 2xl:text-[17px]">Происшествие {p.incident.number}</div>
            {/* A registered card says «Зарег», as the workstation does; a draft shows its last autosave. */}
            <div className="text-[12.5px]">{p.incident.savedLabel ? `${p.viewMenu ? "Зарег" : "Сохр."} ${p.incident.savedLabel}` : "Сохр. —"}</div>
            <div className="text-[12.5px]">
              Опер. {p.operatorNo}, АРМ {p.armNo}, УМЦ
            </div>
          </>
        ) : (
          <div className="text-[13px] text-arm-desc">
            Опер. {p.operatorNo}, АРМ {p.armNo}
            <br />
            карточка не открыта
          </div>
        )}
      </div>
      <div
        className={`flex w-[122px] shrink-0 flex-col items-center justify-center text-white ${p.timer?.late ? "bg-arm-late" : "bg-arm-dark"}`}
        title="Таймер набора карточки: считает от «Принять» до «сохранить»"
        role="timer"
        aria-live="off"
      >
        <div className="text-[38px] font-bold leading-none tabular-nums">{mmss(p.timer?.sec ?? 0)}</div>
        <div className="mt-1 flex w-full justify-around px-2 text-[10px] font-semibold">
          <span>минут</span>
          <span>секунд</span>
        </div>
      </div>
      {p.viewMenu && (
        <div className="flex w-[118px] shrink-0 flex-col gap-1.5" role="group" aria-label="Режим карточки">
          <span data-hk="Shift+F1" className="flex flex-1">
            <button
              type="button"
              aria-pressed={!p.viewMenu.supplementing}
              disabled={p.viewMenu.busy}
              onClick={p.viewMenu.onView}
              className={`flex-1 text-[13px] ${p.viewMenu.supplementing ? "bg-arm-dark text-white hover:bg-black" : "bg-arm-blue text-white"}`}
            >
              просмотр
            </button>
          </span>
          <span data-hk="Shift+F2" className="flex flex-1">
            <button
              type="button"
              aria-pressed={p.viewMenu.supplementing}
              disabled={p.viewMenu.busy}
              onClick={p.viewMenu.onSupplement}
              className={`flex-1 text-[13px] ${p.viewMenu.supplementing ? "bg-arm-blue text-white" : "bg-arm-dark text-white hover:bg-black"}`}
            >
              дополнение
            </button>
          </span>
        </div>
      )}
    </header>
  );
}

function PhoneBlock(props: {
  label: string;
  hk: string;
  id: string;
  value: string;
  readOnly?: boolean;
  onChange?: (v: string) => void;
  onCopyAon?: () => void;
  extraIcons?: React.ReactNode;
}) {
  const foreign = Boolean(props.value) && !props.value.startsWith("+7");
  return (
    <div className="flex min-w-0 flex-1 border-r border-arm-gray" data-hk={props.hk}>
      <div className="flex w-[38px] shrink-0 flex-col items-center justify-around bg-[#e4e7e9] text-[#6b7680]">
        <IconPhone className="h-5 w-5" />
        <IconSms className="h-5 w-5 text-arm-dark" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center px-2.5">
        <div className="flex items-center justify-between text-[12.5px] text-arm-desc">
          <label htmlFor={props.id}>{props.label}</label>
          <span className="flex items-center gap-1.5 text-arm-dark">
            {props.extraIcons}
            <IconGlobe className={`h-3.5 w-3.5 ${foreign ? "text-arm-blue" : ""}`} />
          </span>
        </div>
        <div className="flex items-end gap-2">
          <input
            id={props.id}
            value={props.value}
            placeholder="+7 (   )    -  -"
            maxLength={40}
            readOnly={props.readOnly}
            inputMode="tel"
            onChange={(e) => props.onChange?.(formatPhone(e.target.value))}
            className="min-w-0 flex-1 border-b border-[#9aa3a9] bg-transparent pb-0.5 text-[16px] tracking-wide text-arm-dark outline-none placeholder:text-[#9aa3a9] focus:border-arm-blue read-only:cursor-default xl:text-[18px] 2xl:text-[20px]"
          />
          {props.onCopyAon && (
            <button
              type="button"
              onClick={props.onCopyAon}
              disabled={props.readOnly}
              title="Скопировать номер АОН"
              className="arm-mini-btn mb-0.5 shrink-0 disabled:opacity-40"
            >
              АОН
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function savedLabel(iso: string | null): string | null {
  return iso ? dateTime(iso) : null;
}
