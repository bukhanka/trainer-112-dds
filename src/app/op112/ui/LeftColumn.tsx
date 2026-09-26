"use client";
import { useEffect, useRef, useState } from "react";
import { CALLER_STATUSES, type IncidentAddress, type IncidentCaller } from "@/lib/incident/types";
import type { AddressSuggestion } from "@/lib/op112/gazetteer";
import { capitalizeWords } from "./format";
import { IconClose, IconMap, IconTranslate } from "./icons";
import { getJson } from "./client";

export const CHANNELS = ["МТС", "Мегафон", "Билайн", "Теле2", "МГТС-112", "Мобильное приложение", "ЕССМ", "МЧС", "СМС"];

export function CallerRow(p: {
  caller: IncidentCaller;
  onChange: (patch: Partial<IncidentCaller>) => void;
  readOnly: boolean;
}) {
  return (
    <div className="flex h-[52px] shrink-0 items-center gap-4 bg-arm-panel px-3">
      <div className="min-w-[150px] flex-[1.6]" data-hk="Alt+Q">
        <input
          id="op112-name"
          aria-label="Фамилия и имя заявителя"
          placeholder="Фамилия и имя заявителя"
          value={p.caller.fullName ?? ""}
          readOnly={p.readOnly}
          onChange={(e) => p.onChange({ fullName: capitalizeWords(e.target.value) })}
          className="arm-field"
        />
      </div>
      <select
        aria-label="Статус заявителя"
        value={p.caller.status ?? ""}
        disabled={p.readOnly}
        onChange={(e) => p.onChange({ status: (e.target.value || undefined) as IncidentCaller["status"] })}
        className={`arm-field min-w-[120px] flex-1 ${p.caller.status ? "" : "text-[#8b959b]"}`}
      >
        <option value="">выберите статус</option>
        {CALLER_STATUSES.map((s) => (
          <option key={s} value={s} className="text-arm-dark">
            {s}
          </option>
        ))}
      </select>
      <div className="min-w-0 flex-1" data-hk="Alt+K">
        <select
          id="op112-channel"
          aria-label="Канал связи"
          value={p.caller.channel ?? ""}
          disabled={p.readOnly}
          onChange={(e) => p.onChange({ channel: e.target.value || undefined })}
          className="arm-field"
        >
          <option value="">канал связи</option>
          {CHANNELS.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </div>
      <button
        type="button"
        aria-pressed={Boolean(p.caller.foreignLanguage)}
        disabled={p.readOnly}
        title="Вызов на иностранном языке"
        onClick={() => p.onChange({ foreignLanguage: !p.caller.foreignLanguage })}
        className={`flex h-9 w-10 shrink-0 items-center justify-center border ${p.caller.foreignLanguage ? "border-arm-blue bg-arm-blue text-white" : "border-[#8f989e] bg-white text-arm-dark"}`}
      >
        <IconTranslate className="h-5 w-5" />
      </button>
    </div>
  );
}

type District = { okrug: string; district: string };

const F = ({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) => (
  <label className={`flex min-w-0 flex-col gap-0.5 ${className}`}>
    <span className="arm-label">{label}</span>
    {children}
  </label>
);

export function AddressBlock(p: {
  address: IncidentAddress;
  onChange: (next: IncidentAddress) => void;
  readOnly: boolean;
  okrugs: string[];
  districts: District[];
  onMap: () => void;
}) {
  const a = p.address;
  const [query, setQuery] = useState(() => [a.street, a.house && `${a.house}`].filter(Boolean).join(" ") || a.subject || "");
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2 || q.toLowerCase() === "москва") return;
    const t = setTimeout(() => {
      getJson<{ suggestions: AddressSuggestion[] }>(`/api/op112/address?q=${encodeURIComponent(q)}`)
        .then((r) => {
          setItems(r.suggestions);
          setActive(0);
        })
        .catch(() => setItems([]));
    }, 150);
    return () => clearTimeout(t);
  }, [query, open]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const set = (patch: Partial<IncidentAddress>) => p.onChange({ ...a, ...patch });
  const pick = (s: AddressSuggestion) => {
    // Keep what the operator already typed below (flat, entrance…) and the descriptive address.
    p.onChange({ ...a, ...s.address, flat: a.flat, entrance: a.entrance, floor: a.floor, code: a.code, descriptive: a.descriptive });
    setQuery(s.label.split(" — ")[0]);
    setOpen(false);
    setItems([]);
  };
  const districtsOf = a.okrug ? p.districts.filter((d) => d.okrug === a.okrug) : p.districts;
  const shown = open && query.trim().length >= 2 ? items : [];

  return (
    <div className="flex shrink-0 flex-col gap-2 bg-arm-panel px-3 pb-3 pt-2">
      <div className="flex items-center gap-1.5 text-[12.5px] text-arm-desc">
        Адрес:
        <button type="button" onClick={p.onMap} title="Карта" className="text-arm-dark hover:text-arm-blue">
          <IconMap className="h-4 w-4" />
        </button>
      </div>
      <div className="relative" ref={boxRef} data-hk="Alt+A">
        <div className="flex items-center border-b border-[#b3bbc0] focus-within:border-arm-blue">
          <input
            id="op112-address"
            aria-label="Поиск адреса"
            value={query}
            readOnly={p.readOnly}
            autoComplete="off"
            placeholder="улица и дом одной строкой"
            onFocus={(e) => {
              // The line starts as «Москва»: typing over it is faster than erasing it first.
              e.currentTarget.select();
              setOpen(true);
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (!shown.length) return;
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, shown.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(shown[active]);
              } else if (e.key === "Escape") {
                setOpen(false);
              }
            }}
            className="min-w-0 flex-1 bg-transparent py-1 text-[15px] outline-none"
          />
          {!p.readOnly && (
            <button type="button" title="Стереть строку поиска" onClick={() => setQuery("")} className="p-1 text-arm-dark hover:text-arm-late">
              <IconClose className="h-4 w-4" />
            </button>
          )}
        </div>
        {shown.length > 0 && (
          <ul className="absolute left-0 right-0 top-full z-40 max-h-72 overflow-y-auto border border-[#c9ced1] bg-white shadow-lg" role="listbox">
            {shown.map((s, i) => (
              <li key={s.label} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(s)}
                  className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-[14px] ${i === active ? "bg-[#e8f2f9]" : "hover:bg-[#f3f5f6]"}`}
                >
                  <span>{s.label}</span>
                  <span className="shrink-0 text-[11px] text-arm-desc">{s.source}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="grid grid-cols-[1fr_1fr_1.4fr] gap-x-4 gap-y-2">
        <F label="Страна:">
          <input className="arm-field" value={a.country ?? ""} readOnly={p.readOnly} onChange={(e) => set({ country: e.target.value })} />
        </F>
        <F label="Субъект:">
          <input className="arm-field" value={a.subject ?? ""} readOnly={p.readOnly} onChange={(e) => set({ subject: e.target.value })} />
        </F>
        <F label="Населенный пункт:">
          <input className="arm-field" value={a.city ?? ""} readOnly={p.readOnly} onChange={(e) => set({ city: e.target.value })} />
        </F>
      </div>
      <div className="grid grid-cols-[1.6fr_1fr_1fr] gap-x-4">
        <F label="Объект:">
          <input className="arm-field" value={a.object ?? ""} readOnly={p.readOnly} onChange={(e) => set({ object: e.target.value })} />
        </F>
        <F label="Округ:">
          <select
            className="arm-field"
            value={a.okrug ?? ""}
            disabled={p.readOnly}
            onChange={(e) => set({ okrug: e.target.value || undefined, district: undefined })}
          >
            <option value="" />
            {p.okrugs.map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        </F>
        <F label="Район:">
          <select
            className="arm-field"
            value={a.district ?? ""}
            disabled={p.readOnly}
            onChange={(e) => {
              const d = p.districts.find((x) => x.district === e.target.value);
              set({ district: e.target.value || undefined, okrug: d?.okrug || a.okrug });
            }}
          >
            <option value="" />
            {a.district && !districtsOf.some((d) => d.district === a.district) && <option>{a.district}</option>}
            {districtsOf.map((d) => (
              <option key={d.district}>{d.district}</option>
            ))}
          </select>
        </F>
      </div>
      <div className="grid grid-cols-[2fr_1fr_1fr] gap-x-4">
        <F label="Улица:">
          <input className="arm-field" value={a.street ?? ""} readOnly={p.readOnly} onChange={(e) => set({ street: e.target.value })} />
        </F>
        <F label="Дом/Вл:">
          <input className="arm-field" value={a.house ?? ""} readOnly={p.readOnly} onChange={(e) => set({ house: e.target.value })} />
        </F>
        <F label="Корпус:">
          <input className="arm-field" value={a.building ?? ""} readOnly={p.readOnly} onChange={(e) => set({ building: e.target.value })} />
        </F>
      </div>
      <div className="grid grid-cols-5 gap-x-4">
        <F label="Стр/соор:">
          <input className="arm-field" value={a.structure ?? ""} readOnly={p.readOnly} onChange={(e) => set({ structure: e.target.value })} />
        </F>
        <F label="Квартира/офис:">
          <input className="arm-field" value={a.flat ?? ""} readOnly={p.readOnly} onChange={(e) => set({ flat: e.target.value })} />
        </F>
        <F label="Подъезд:">
          <input className="arm-field" value={a.entrance ?? ""} readOnly={p.readOnly} onChange={(e) => set({ entrance: e.target.value })} />
        </F>
        <F label="Этаж:">
          <input className="arm-field" value={a.floor ?? ""} readOnly={p.readOnly} onChange={(e) => set({ floor: e.target.value })} />
        </F>
        <F label="Код:">
          <input className="arm-field" value={a.code ?? ""} readOnly={p.readOnly} onChange={(e) => set({ code: e.target.value })} />
        </F>
      </div>
      <F label="Описательный адрес:">
        <textarea
          rows={2}
          className="arm-field resize-none"
          value={a.descriptive ?? ""}
          readOnly={p.readOnly}
          onChange={(e) => set({ descriptive: e.target.value })}
        />
      </F>
      {!p.readOnly && (
        <div className="flex justify-end">
          <button
            type="button"
            className="arm-mini-btn"
            onClick={() => {
              p.onChange({});
              setQuery("");
            }}
          >
            очистить адрес
          </button>
        </div>
      )}
    </div>
  );
}

export function DescriptionBlock(p: { value: string; onChange: (v: string) => void; readOnly: boolean; hints: boolean }) {
  const first = p.value.trim().slice(0, 100);
  return (
    <div className="flex min-h-[150px] flex-1 flex-col bg-arm-panel px-3 pb-2 pt-2" data-hk="Alt+O">
      <label htmlFor="op112-description" className="arm-label">
        Описание со слов заявителя
      </label>
      <textarea
        id="op112-description"
        placeholder="введите"
        maxLength={1999}
        value={p.value}
        readOnly={p.readOnly}
        onChange={(e) => p.onChange(e.target.value)}
        className="arm-field mt-1 min-h-[60px] flex-1 resize-none text-[15px]"
      />
      <div className="mt-1 flex items-start justify-between gap-3 text-[11.5px] text-arm-desc">
        <span>
          В службу 103 уходят первые 100 символов
          {p.hints && first && (
            <>
              : <span className="text-arm-dark">«{first}{p.value.trim().length > 100 ? "…" : ""}»</span>
            </>
          )}
        </span>
        <span className="shrink-0 tabular-nums">{p.value.length} / 1999</span>
      </div>
    </div>
  );
}
