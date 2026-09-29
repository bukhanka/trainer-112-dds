"use client";
import { useEffect, useRef, useState } from "react";
import type { CardRef } from "@/lib/op112/links";
import { getJson } from "./client";
import { hhmm } from "./format";
import { IconLink } from "./icons";
import { Modal } from "./Services";

/** The orange «⚠ совпадение» button: in the АОН block for a phone match, in the address block for a place match. */
export function MatchButton(p: { count: number; onOpen: () => void; title: string }) {
  return (
    <button
      type="button"
      onClick={p.onOpen}
      title={p.title}
      className="inline-flex items-center gap-1 bg-arm-orange px-1.5 py-0.5 text-[11.5px] font-semibold text-white hover:brightness-95"
    >
      ⚠ совпадение{p.count > 1 ? ` (${p.count})` : ""}
    </button>
  );
}

function CardRows(p: { cards: CardRef[]; linkedId: string | null; busy: boolean; onLink: (id: string) => void; id?: string }) {
  if (!p.cards.length) return <div className="px-5 py-6 text-center text-[14px] text-arm-desc">Карточек не найдено</div>;
  return (
    <ul id={p.id} className="divide-y divide-[#e3e6e8]" aria-label="Список происшествий">
      {p.cards.map((c) => {
        const linked = p.linkedId === c.id;
        return (
          <li key={c.id} className="flex items-center gap-3 px-5 py-2.5 text-[13.5px]">
            <div className="w-[92px] shrink-0">
              <div className="font-bold tabular-nums">{c.number}</div>
              <div className="text-[12px] text-arm-desc">{hhmm(c.savedAt)}</div>
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold text-arm-dark">{c.place}</div>
              <div className="truncate text-[12.5px] text-arm-desc">
                {c.kinds || "тип не выбран"} · {c.operator}
                {c.mainNumber ? ` · связана с № ${c.mainNumber}` : ""}
              </div>
            </div>
            {c.link && c.link !== "ok" && !linked ? (
              // The same number is not the same incident: linking waits for the same place.
              <span className="w-[210px] shrink-0 text-right text-[12px] leading-snug text-arm-desc">
                {c.link === "noPlace" ? "совпал только номер — заполните адрес: привязывают вызов о том же месте" : "совпал только номер, адрес другой — другое происшествие"}
              </span>
            ) : (
              <button
                type="button"
                disabled={p.busy || linked}
                onClick={() => p.onLink(c.id)}
                className={`shrink-0 px-4 py-1.5 text-[13.5px] font-semibold ${linked ? "bg-[#eaf7ee] text-[#1c6b33]" : "bg-arm-blue text-white hover:brightness-95 disabled:opacity-60"}`}
              >
                {linked ? "связана" : "привязать"}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/** «Совпадение»: the window the orange button opens, as in the instruction's figure 51. */
export function MatchModal(p: { by: "phone" | "address"; cards: CardRef[]; linkedId: string | null; busy: boolean; onLink: (id: string) => void; onClose: () => void }) {
  return (
    <Modal
      title={p.by === "phone" ? "Есть карточка с заявителем по этому номеру:" : "Есть карточка по этому адресу:"}
      onClose={p.onClose}
      width="max-w-[820px]"
      footer={
        <button type="button" autoFocus className="border border-[#8f989e] px-5 py-2.5 text-[15px] text-arm-dark hover:bg-[#f3f5f6]" onClick={p.onClose}>
          закрыть и продолжить заполнение новой
        </button>
      }
    >
      <CardRows cards={p.cards} linkedId={p.linkedId} busy={p.busy} onLink={p.onLink} />
      <p className="px-5 pb-3 pt-1 text-[12.5px] text-arm-desc">
        «привязать» — текущая карточка станет подчинённой, выбранная — главной. В карточке, которая ещё не сохранена, связь установится при сохранении.
      </p>
    </Modal>
  );
}

/**
 * «Создать связь» (Alt+W): search the lesson's saved cards by number, address or type and link to one. Inside the
 * window, as in the instruction: Alt+1 — the search, Alt+2 — the list, Alt+3 — the back button.
 */
export function LinkModal(p: { incidentId: string; linked: { id: string; number: number } | null; busy: boolean; onLink: (id: string | null) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [cards, setCards] = useState<CardRef[] | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      getJson<{ cards: CardRef[] }>(`/api/op112/incidents/${p.incidentId}/link?q=${encodeURIComponent(q)}`)
        .then((r) => setCards(r.cards))
        .catch(() => setCards([]));
    }, 200);
    return () => clearTimeout(t);
  }, [q, p.incidentId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const list = document.getElementById("op112-link-list");
      const target =
        e.code === "Digit1"
          ? searchRef.current
          : e.code === "Digit2"
            ? (list?.querySelector("button:not(:disabled)") as HTMLElement | null)
            : e.code === "Digit3"
              ? backRef.current
              : null;
      if (!target) return;
      e.preventDefault();
      target.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Modal
      title="Создание связи"
      onClose={p.onClose}
      width="max-w-[860px]"
      footer={
        <span data-hk="Alt+3" className="flex">
          <button ref={backRef} type="button" className="border border-[#8f989e] px-5 py-2.5 text-[15px] text-arm-dark hover:bg-[#f3f5f6]" onClick={p.onClose}>
            вернуться к карточке
          </button>
        </span>
      }
    >
      <div className="sticky top-0 z-10 border-b border-[#dde1e3] bg-white px-5 py-3">
        {p.linked && (
          <div className="mb-2 flex items-center gap-3 text-[13.5px]">
            <IconLink className="h-4 w-4 text-arm-blue" />
            <span>
              Связана с карточкой <b>№ {p.linked.number}</b> (главная)
            </span>
            <button type="button" className="arm-mini-btn" disabled={p.busy} onClick={() => p.onLink(null)}>
              отвязать
            </button>
          </div>
        )}
        <div data-hk="Alt+1">
          <input
            ref={searchRef}
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск происшествия: номер, улица, тип"
            aria-label="Поиск происшествия"
            className="arm-field"
          />
        </div>
        <div className="mt-1.5 text-[12px] text-arm-desc">Сохранённые карточки этого занятия, новые сверху.</div>
      </div>
      <div data-hk="Alt+2">
        {cards ? <CardRows cards={cards} linkedId={p.linked?.id ?? null} busy={p.busy} onLink={(id) => p.onLink(id)} id="op112-link-list" /> : <div className="px-5 py-6 text-center text-arm-desc">Загрузка…</div>}
      </div>
    </Modal>
  );
}
