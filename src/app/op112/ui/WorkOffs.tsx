"use client";
import { useState } from "react";
import type { ServiceCallDto } from "@/lib/op112/state";
import type { PhoneNotice, WorkOff } from "@/lib/op112/workoffs";
import { hhmm } from "./format";
import { IconCheck, IconPhone } from "./icons";
import type { Plate, ServiceItem } from "./Services";

export type WorkOffDraft = { serviceId: number | null; where: string; phone: string; acceptedBy: string; summary: string; callId: string | null };

export const EMPTY_ROW: WorkOffDraft = { serviceId: null, where: "", phone: "", acceptedBy: "", summary: "", callId: null };

const NOTICE_LABEL: Record<NonNullable<PhoneNotice["problem"]> | "ok", string> = {
  no_call: "не оповещена",
  not_accepted: "карточку не приняли",
  no_record: "отработка не записана",
  no_person: "не записано, кто принял",
  wrong_person: "кто принял — не тот",
  ok: "оповещена",
};

/**
 * «Отработки» of a saved card: calls to services the system does not notify by itself. The instruction: the row
 * «Служба | Куда звонили | Телефон | Кто принял | Суть сообщения», the handset calls, the tick (or Enter) saves
 * once at least one field is filled. Services that get cards only by phone are listed above with their state.
 */
export function WorkOffs(p: {
  log: WorkOff[];
  notices: PhoneNotice[];
  plates: Plate[];
  services: ServiceItem[];
  row: WorkOffDraft;
  onRow: (row: WorkOffDraft) => void;
  activeCall: ServiceCallDto | null;
  busy: boolean;
  onDial: (serviceId: number) => void;
  onSave: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const r = p.row;
  const filled = Boolean(r.serviceId || r.where.trim() || r.phone.trim() || r.acceptedBy.trim() || r.summary.trim());
  const onCard = p.plates.map((pl) => pl.serviceId);
  const others = p.services.filter((s) => !onCard.includes(s.id)).sort((a, b) => a.shortName.localeCompare(b.shortName, "ru"));
  const set = (patch: Partial<WorkOffDraft>) => {
    setTouched(true);
    p.onRow({ ...r, ...patch });
  };
  const pick = (id: number | null) => {
    const s = id ? p.services.find((x) => x.id === id) : undefined;
    // A different service is a different call: its phone comes from the directory, the call id is dropped.
    set({ serviceId: id, phone: s?.phone ?? "", callId: r.serviceId === id ? r.callId : null });
  };
  const save = () => {
    if (filled && !p.busy) {
      p.onSave();
      setTouched(false);
    }
  };
  const keys = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  };
  const calling = p.activeCall?.status === "ACTIVE";

  return (
    <section id="op112-workoffs" data-hk="Alt+O" aria-label="Отработки" className="flex max-h-[42%] shrink-0 flex-col bg-white">
      <div className="flex items-center gap-3 bg-arm-dark px-3 py-1.5 text-white">
        <h3 className="text-[14px] font-bold">Отработки</h3>
        <span className="truncate text-[12px] text-white/75">звонки в службы, которые не оповещены автоматически</span>
      </div>
      {p.notices.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[#e3e6e8] px-3 py-1.5 text-[13px]">
          <span className="text-arm-desc">Только по телефону:</span>
          {p.notices.map((n) => {
            const ok = !n.problem;
            return (
              <button
                key={n.serviceId}
                type="button"
                disabled={p.busy || calling}
                onClick={() => {
                  pick(n.serviceId);
                  p.onDial(n.serviceId);
                }}
                title={ok ? "Карточка передана по телефону" : "Позвонить в службу"}
                data-phone-notice={ok ? "ok" : n.problem}
                className={`inline-flex items-center gap-1.5 border px-2 py-1 disabled:opacity-60 ${ok ? "border-[#9fd0ad] bg-[#eaf7ee] text-[#1c6b33]" : "border-arm-plate-gray bg-[#f1f1f1] text-arm-dark hover:border-arm-dark"}`}
              >
                {ok ? <IconCheck className="h-3.5 w-3.5" /> : <IconPhone className="h-3.5 w-3.5" />}
                <b>{n.name}</b> — {NOTICE_LABEL[n.problem ?? "ok"]}
              </button>
            );
          })}
        </div>
      )}
      <div className="min-h-0 overflow-y-auto">
        <table className="w-full table-fixed border-collapse text-[12.5px]">
          <colgroup>
            <col className="w-[92px]" />
            <col className="w-[170px]" />
            <col />
            <col className="w-[150px]" />
            <col className="w-[140px]" />
            <col />
            <col className="w-[76px]" />
          </colgroup>
          <thead>
            <tr className="bg-arm-panel text-left text-arm-desc">
              <th className="px-2 py-1 font-normal">Опер., время</th>
              <th className="px-2 py-1 font-normal">Служба</th>
              <th className="px-2 py-1 font-normal">Куда звонили</th>
              <th className="px-2 py-1 font-normal">Телефон</th>
              <th className="px-2 py-1 font-normal">Кто принял</th>
              <th className="px-2 py-1 font-normal">Суть сообщения</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {p.log.map((e) => (
              <tr key={e.id} className="border-b border-[#eceef0] align-top">
                <td className="px-2 py-1 tabular-nums">
                  {e.operator} · {hhmm(e.at)}
                </td>
                <td className="truncate px-2 py-1 font-semibold">{e.service ?? ""}</td>
                <td className="truncate px-2 py-1">{e.where ?? ""}</td>
                <td className="truncate px-2 py-1 tabular-nums">{e.phone ?? ""}</td>
                <td className="truncate px-2 py-1">{e.acceptedBy ?? ""}</td>
                <td className="px-2 py-1">{e.summary ?? ""}</td>
                <td />
              </tr>
            ))}
            <tr className="align-middle">
              <td className="px-2 py-1.5 text-[11.5px] text-arm-desc">{p.log.length ? "ещё отработка" : "новая"}</td>
              <td className="px-1 py-1.5">
                <select
                  id="op112-workoff-service"
                  aria-label="Служба"
                  value={r.serviceId ?? ""}
                  onChange={(e) => pick(e.target.value ? Number(e.target.value) : null)}
                  onKeyDown={keys}
                  className="arm-field text-[13px]"
                >
                  <option value="">служба</option>
                  <optgroup label="В карточке">
                    {p.plates.map((pl) => (
                      <option key={pl.serviceId} value={pl.serviceId}>
                        {pl.shortName}
                        {pl.phoneOnly ? " (по телефону)" : ""}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Справочник">
                    {others.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.shortName}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </td>
              <td className="px-1 py-1.5">
                <input aria-label="Куда звонили" maxLength={200} value={r.where} onChange={(e) => set({ where: e.target.value })} onKeyDown={keys} placeholder="куда" className="arm-field text-[13px]" />
              </td>
              <td className="px-1 py-1.5">
                <input aria-label="Телефон" maxLength={40} value={r.phone} onChange={(e) => set({ phone: e.target.value })} onKeyDown={keys} placeholder="телефон" className="arm-field text-[13px]" />
              </td>
              <td className="px-1 py-1.5">
                <input
                  id="op112-workoff-person"
                  aria-label="Кто принял"
                  maxLength={120}
                  value={r.acceptedBy}
                  onChange={(e) => set({ acceptedBy: e.target.value })}
                  onKeyDown={keys}
                  placeholder="кто принял"
                  className="arm-field text-[13px]"
                />
              </td>
              <td className="px-1 py-1.5">
                <input aria-label="Суть сообщения" maxLength={500} value={r.summary} onChange={(e) => set({ summary: e.target.value })} onKeyDown={keys} placeholder="суть сообщения" className="arm-field text-[13px]" />
              </td>
              <td className="px-1 py-1.5">
                <div className="flex gap-1">
                  <button
                    type="button"
                    title={r.serviceId ? "Позвонить в службу" : "Выберите службу, чтобы позвонить"}
                    aria-label="Позвонить"
                    disabled={!r.serviceId || p.busy || calling}
                    onClick={() => r.serviceId && p.onDial(r.serviceId)}
                    className="flex h-8 w-8 items-center justify-center border border-[#8f989e] text-arm-dark enabled:hover:border-arm-blue enabled:hover:text-arm-blue disabled:opacity-40"
                  >
                    <IconPhone className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    title="Сохранить отработку (Enter)"
                    aria-label="Сохранить отработку"
                    disabled={!filled || p.busy}
                    onClick={save}
                    className="flex h-8 w-8 items-center justify-center bg-arm-orange text-white disabled:bg-[#d5d9dc] disabled:text-white"
                  >
                    <IconCheck className="h-4 w-4" />
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        {!p.log.length && !touched && (
          <p className="px-3 pb-2 text-[12px] text-arm-desc">
            Выберите службу, позвоните трубкой в строке, затем запишите, кто принял и суть. Галочка сохраняет строку.
          </p>
        )}
      </div>
    </section>
  );
}
