"use client";
import { useMemo, useState } from "react";
import { plateCaption } from "@/lib/dds/format";
import { hhmm } from "./format";
import { IconAlert, IconBell, IconChevronUp, IconClose, IconHand, IconLink, IconPhone, IconPlus, IconStopwatch } from "./icons";

export type Plate = {
  serviceId: number;
  shortName: string;
  fullName?: string | null;
  isMain: boolean;
  auto: boolean;
  status?: string;
  addedAt?: string;
  phoneOnly?: boolean;
};
export type ServiceItem = { id: number; shortName: string; fullName: string | null; phoneOnly?: boolean; phone?: string };

const STATUS_RU: Record<string, string> = {
  ADDED: "Добавлена",
  RECEIVED: "Получена службой",
  ACCEPTED: "Принята",
  REJECTED: "Не принята",
  STARTED: "Начало реагирования",
  ARRIVED: "Прибытие",
  WORKING: "Проведение работ",
  FINISHED: "Работы завершены",
  REFUSED: "Отказ от выполнения работ",
};

export function ServicesBar(p: {
  plates: Plate[];
  saved: boolean;
  disabled: boolean;
  important: boolean;
  onAdd: () => void;
  onRemove: (id: number) => void;
  onSave: () => void;
  onWorked: () => void;
  /** «Дополнить» is open: the main button saves the supplement instead of «отработана». */
  supplement?: boolean;
  onSupplementSave?: () => void;
  /** After «сохранить»: the handset on a grey plate calls the service (a row of the work-offs). */
  onDial?: (serviceId: number) => void;
  onImportant: () => void;
  onNotAvailable: (what: string) => void;
}) {
  return (
    <footer
      className={`flex h-[64px] shrink-0 items-stretch gap-2 px-2 text-white ${p.saved ? "bg-arm-dark" : "bg-arm-orange"}`}
      data-hk="Alt+Z"
    >
      <div className="flex items-center pr-2 text-[14px]">Службы:</div>
      <div className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {p.plates.map((s) => (
          <div
            key={s.serviceId}
            className={`relative flex w-[112px] shrink-0 flex-col items-center justify-center border-r border-white/25 px-1 ${s.phoneOnly ? "bg-arm-plate-gray" : ""}`}
            title={`${s.fullName ? `${s.shortName} (${s.fullName})` : s.shortName}${s.phoneOnly ? " — оповещается по телефону" : ""}`}
          >
            {p.saved ? (
              <IconChevronUp className="absolute left-1 top-0.5 h-3.5 w-3.5 opacity-80" />
            ) : (
              // Before saving the handset transfers the caller to the service (the instruction's «Управление звонком»).
              <button
                type="button"
                title="Позвонить"
                onClick={() => p.onNotAvailable("Перевод заявителя в службу")}
                className="absolute left-1 top-1 p-0 opacity-90 hover:opacity-100"
              >
                <IconPhone className="h-3.5 w-3.5" />
              </button>
            )}
            {p.saved && s.phoneOnly && p.onDial && (
              <button
                type="button"
                title="Позвонить: служба получает карточку только по телефону"
                aria-label={`Позвонить: ${s.shortName}`}
                onClick={() => p.onDial?.(s.serviceId)}
                className="absolute right-1 top-0.5 p-0.5 hover:text-arm-orange"
              >
                <IconPhone className="h-4 w-4" />
              </button>
            )}
            {!p.saved && !s.auto && (
              <button type="button" onClick={() => p.onRemove(s.serviceId)} title="Убрать службу" className="absolute right-1 top-0.5 p-0.5 hover:text-arm-dark">
                <IconClose className="h-3.5 w-3.5" />
              </button>
            )}
            <span
              className={`line-clamp-2 w-full break-words text-center font-bold leading-[1.1] ${plateCaption(s.shortName).length > 11 ? "text-[11.5px]" : "text-[13px]"} ${s.isMain ? "underline decoration-double underline-offset-4" : ""}`}
            >
              {plateCaption(s.shortName)}
            </span>
            {p.saved && s.status && (
              <span className="mt-0.5 text-[10.5px] text-white/85">
                {hhmm(s.addedAt)} {STATUS_RU[s.status] ?? s.status}
              </span>
            )}
          </div>
        ))}
        {!p.saved && (
          <div className="flex items-center px-2">
            <button type="button" id="op112-add-service" onClick={p.onAdd} disabled={p.disabled} title="Добавить службу" className="arm-bar-btn w-[50px]">
              <IconPlus className="h-6 w-6" />
            </button>
          </div>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <span data-hk="Alt+S" className="flex">
          {p.saved && p.supplement ? (
            <button type="button" className="arm-bar-btn px-5 text-[21px] font-bold" onClick={p.onSupplementSave}>
              сохранить
            </button>
          ) : p.saved ? (
            <button type="button" className="arm-bar-btn px-5 text-[21px] font-bold" onClick={p.onWorked}>
              отработана
            </button>
          ) : (
            <button type="button" className="arm-bar-btn px-5 text-[21px] font-bold" disabled={p.disabled} onClick={p.onSave}>
              сохранить
            </button>
          )}
        </span>
        <button type="button" className="arm-bar-btn" title="Создать связь (Alt+W)" onClick={() => p.onNotAvailable("Связи карточек")}>
          <IconLink className="h-6 w-6" />
        </button>
        <button type="button" className="arm-bar-btn" title="Напоминание (Alt+B)" onClick={() => p.onNotAvailable("Напоминание")}>
          <IconStopwatch className="h-6 w-6" />
        </button>
        <button type="button" className="arm-bar-btn" title="Перерыв" onClick={() => p.onNotAvailable("Перерыв")}>
          <IconHand className="h-6 w-6" />
        </button>
        <button
          type="button"
          className={`arm-bar-btn ${p.important ? "bg-white !text-arm-orange" : ""}`}
          aria-pressed={p.important}
          title="Важное происшествие (Alt+V)"
          disabled={p.disabled}
          onClick={p.onImportant}
        >
          <IconBell className="h-6 w-6" />
        </button>
        <button type="button" className="arm-bar-btn" title="Сообщить о проблеме (Alt+M)" onClick={() => p.onNotAvailable("Сообщить о проблеме")}>
          <IconAlert className="h-6 w-6" />
        </button>
        <button type="button" className="arm-bar-btn" title="Закрыть карточку" disabled={!p.saved} onClick={p.onWorked}>
          <IconClose className="h-6 w-6" />
        </button>
      </div>
    </footer>
  );
}

export function Modal(p: { title: string; onClose: () => void; children: React.ReactNode; width?: string; footer?: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4" role="dialog" aria-modal="true" aria-label={p.title}>
      <div className={`flex max-h-[88vh] w-full flex-col bg-white shadow-2xl ${p.width ?? "max-w-[900px]"}`}>
        <div className="flex items-center justify-between border-b border-[#dde1e3] px-5 py-3">
          <h2 className="text-[17px] font-semibold text-arm-dark">{p.title}</h2>
          <button type="button" onClick={p.onClose} title="Закрыть (Esc)" className="p-1 text-arm-dark hover:text-arm-late">
            <IconClose className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{p.children}</div>
        {p.footer && <div className="flex justify-end gap-2 border-t border-[#dde1e3] px-5 py-3">{p.footer}</div>}
      </div>
    </div>
  );
}

export function AddServicesModal(p: {
  services: ServiceItem[];
  autoIds: number[];
  manualIds: number[];
  onSave: (manualIds: number[]) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [manual, setManual] = useState<number[]>(p.manualIds);
  const list = useMemo(() => {
    const words = q.toLowerCase().replace(/ё/g, "е").split(/\s+/).filter(Boolean);
    return p.services.filter((s) => {
      const hay = `${s.shortName} ${s.fullName ?? ""}`.toLowerCase().replace(/ё/g, "е");
      return words.every((w) => hay.includes(w));
    });
  }, [q, p.services]);
  const toggle = (id: number) => {
    if (p.autoIds.includes(id)) return;
    setManual((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  };
  return (
    <Modal
      title="Добавьте службы"
      onClose={p.onClose}
      footer={
        <button type="button" className="bg-arm-dark px-6 py-2.5 text-[15px] font-semibold text-white hover:bg-black" onClick={() => p.onSave(manual)}>
          Сохранить и закрыть
        </button>
      }
    >
      <div className="sticky top-0 z-10 border-b border-[#dde1e3] bg-white px-5 py-3">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Поиск ..."
          aria-label="Поиск службы"
          className="arm-field"
        />
        <div className="mt-1.5 text-[12px] text-arm-desc">
          Всего служб: {p.services.length}. Синие — в карточке. Подобранные системой убрать нельзя: в штатной ситуации список служб не правят.
        </div>
      </div>
      <ul>
        {list.map((s) => {
          const auto = p.autoIds.includes(s.id);
          const on = auto || manual.includes(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => toggle(s.id)}
                aria-pressed={on}
                title={auto ? "Подобрана автоматически — удалить нельзя" : undefined}
                className={`w-full border-b border-[#e3e6e8] px-5 py-3 text-left text-[15px] ${on ? "bg-arm-blue text-white" : "hover:bg-[#f3f5f6]"} ${auto ? "cursor-not-allowed" : ""}`}
              >
                {s.fullName && s.fullName !== s.shortName ? `${s.shortName} (${s.fullName})` : s.shortName}
              </button>
            </li>
          );
        })}
        {!list.length && <li className="px-5 py-6 text-center text-arm-desc">Ничего не найдено</li>}
      </ul>
    </Modal>
  );
}

export function NotifyModal(p: { plates: Plate[]; warnings: string[]; busy: boolean; onConfirm: () => void; onBack: () => void }) {
  return (
    <Modal
      title="Список оповещаемых служб"
      onClose={p.onBack}
      width="max-w-[760px]"
      footer={
        <>
          <button type="button" className="border border-[#8f989e] px-5 py-2.5 text-[15px] text-arm-dark hover:bg-[#f3f5f6]" onClick={p.onBack}>
            вернуться к заполнению
          </button>
          <button
            type="button"
            autoFocus
            disabled={p.busy}
            className="bg-arm-orange px-5 py-2.5 text-[15px] font-bold text-white hover:brightness-95 disabled:opacity-60"
            onClick={p.onConfirm}
          >
            {p.busy ? "сохраняем…" : "оповестить и сохранить карточку"}
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4 px-5 py-4">
        {p.plates.length ? (
          <div className="flex flex-wrap gap-2">
            {p.plates.map((s) => (
              <span key={s.serviceId} className={`bg-arm-orange px-3 py-2 text-[14px] font-bold text-white ${s.isMain ? "underline decoration-double underline-offset-4" : ""}`}>
                {s.shortName}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-[14px] text-arm-desc">Службы не подобраны: карточка уйдёт только в журнал.</div>
        )}
        {p.warnings.length > 0 && (
          <div className="border-l-4 border-arm-orange bg-[#fff4ef] px-3 py-2 text-[13.5px] text-arm-dark">
            <div className="font-semibold">Внимание! Необходимо заполнить:</div>
            <ul className="mt-1 list-disc pl-5">
              {p.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <div className="mt-1 text-arm-desc">После сохранения ФИО и статус заявителя изменить нельзя.</div>
          </div>
        )}
      </div>
    </Modal>
  );
}

export function EmptyCardModal(p: { reason: "noContact" | "dropped"; busy: boolean; onConfirm: () => void; onBack: () => void }) {
  return (
    <Modal
      title="Сохранить карточку как пустую?"
      onClose={p.onBack}
      width="max-w-[560px]"
      footer={
        <>
          <button type="button" autoFocus className="border border-[#8f989e] px-5 py-2.5 text-[15px] text-arm-dark hover:bg-[#f3f5f6]" onClick={p.onBack}>
            вернуться и заполнить
          </button>
          <button type="button" disabled={p.busy} className="bg-arm-orange px-5 py-2.5 text-[15px] font-bold text-white disabled:opacity-60" onClick={p.onConfirm}>
            сохранить карточку как пустую
          </button>
        </>
      }
    >
      <div className="px-5 py-4 text-[14px] text-arm-dark">
        Причина: <b>{p.reason === "noContact" ? "нет контакта" : "срыв звонка"}</b>. Пустая карточка сразу получает статус «Завершена», службы не
        оповещаются.
      </div>
    </Modal>
  );
}

export function PhoneWarnModal(p: { missing: { name: string; reason: "call" | "record" }[]; busy: boolean; onConfirm: () => void; onBack: () => void }) {
  return (
    <Modal
      title="Не все службы оповещены по телефону"
      onClose={p.onBack}
      width="max-w-[600px]"
      footer={
        <>
          <button type="button" autoFocus className="border border-[#8f989e] px-5 py-2.5 text-[15px] text-arm-dark hover:bg-[#f3f5f6]" onClick={p.onBack}>
            вернуться к отработкам
          </button>
          <button type="button" disabled={p.busy} className="bg-arm-orange px-5 py-2.5 text-[15px] font-bold text-white disabled:opacity-60" onClick={p.onConfirm}>
            отработана без звонка
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-2 px-5 py-4 text-[14px] text-arm-dark">
        <p>Эти службы получают карточку только по телефону, система их не оповещает:</p>
        <ul className="list-disc pl-5">
          {p.missing.map((m) => (
            <li key={m.name}>
              <b>{m.name}</b> — {m.reason === "call" ? "не позвонили или карточку не приняли" : "звонок был, отработка не записана (кто принял, суть)"}
            </li>
          ))}
        </ul>
        <p className="text-arm-desc">Позвоните из строки отработки (Alt+O) и запишите, кто принял. Если закрыть карточку сейчас, разбор отметит службу как не оповещённую.</p>
      </div>
    </Modal>
  );
}
