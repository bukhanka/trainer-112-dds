"use client";
import { useRef, useState } from "react";
import type { IncidentFlags } from "@/lib/incident/types";
import { FREQUENT_KEYS, SIGNIFICANT_KEYS, pruneAnswers, questionCard, rowVisible, searchWhatHappened, whatHappened } from "@/lib/op112/catalog";
import type { CardAnswers, QuestionRow } from "@/lib/op112/types";
import { IconClose } from "./icons";

type TopFlag = "victims" | "refusedAmbulance" | "noAccess";

export function FlagsBar(p: {
  flags: IncidentFlags;
  onToggle: (flag: TopFlag) => void;
  readOnly: boolean;
  typeChosen: boolean;
  onEmpty: (reason: "noContact" | "dropped") => void;
}) {
  const btn = (flag: TopFlag, label: React.ReactNode, hk?: string) => (
    <span data-hk={hk} className="flex min-w-[112px] flex-1">
      <button
        type="button"
        id={`op112-flag-${flag}`}
        aria-pressed={Boolean(p.flags[flag])}
        disabled={p.readOnly}
        onClick={() => p.onToggle(flag)}
        className="arm-flag-btn w-full"
      >
        {label}
      </button>
    </span>
  );
  return (
    <div className="flex shrink-0 flex-wrap gap-2">
      <div className="flex min-w-[360px] flex-[3] items-center gap-1.5 bg-arm-panel p-2">
        {btn("victims", "Пострадавшие", "Alt+P")}
        {btn(
          "refusedAmbulance",
          <>
            Нет на месте/
            <br />
            Отказ от скорой
          </>,
        )}
        {btn(
          "noAccess",
          <>
            Нет доступа/
            <br />
            Заблокированные
          </>,
        )}
      </div>
      <div className="flex flex-1 items-center gap-1.5 bg-arm-panel p-2" data-hk="Alt+N">
        <button type="button" className="arm-orange-btn flex-1" disabled={p.readOnly || p.typeChosen} onClick={() => p.onEmpty("noContact")}>
          нет контакта
        </button>
        <button type="button" className="arm-orange-btn flex-1" disabled={p.readOnly || p.typeChosen} onClick={() => p.onEmpty("dropped")}>
          срыв звонка
        </button>
      </div>
    </div>
  );
}

export function TypeBlock(p: {
  cards: string[];
  answers: Record<string, CardAnswers>;
  readOnly: boolean;
  onCards: (cards: string[], answers: Record<string, CardAnswers>) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const results = open ? searchWhatHappened(q, 60).filter((w) => !p.cards.includes(w.key)) : [];

  const add = (key: string) => {
    if (p.readOnly || p.cards.includes(key)) return;
    p.onCards([...p.cards, key], p.answers);
    setQ("");
    setOpen(false);
  };
  const remove = (key: string) => {
    if (p.readOnly) return;
    const next = { ...p.answers };
    delete next[key];
    p.onCards(
      p.cards.filter((c) => c !== key),
      next,
    );
  };
  const setAnswers = (key: string, a: CardAnswers) => {
    p.onCards(p.cards, { ...p.answers, [key]: pruneAnswers(questionCard(key), a) });
  };
  const first = p.cards.length === 0;

  return (
    <>
      <div className={`shrink-0 bg-arm-panel px-3 pt-2 ${first ? "pb-3" : "pb-1"}`}>
        {first && <div className={`text-[12.5px] ${open ? "text-arm-blue" : "text-arm-desc"}`}>Введите тип происшествия</div>}
        <div className="relative" data-hk="Alt+T">
          <input
            id="op112-type"
            ref={inputRef}
            aria-label="Тип происшествия"
            value={q}
            readOnly={p.readOnly}
            autoComplete="off"
            placeholder={first ? "что случилось?" : "добавить тип происшествия"}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => {
              setQ(e.target.value);
              setActive(0);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setActive((i) => Math.min(i + 1, results.length - 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(i - 1, 0));
              } else if (e.key === "Enter" && results[active]) {
                e.preventDefault();
                add(results[active].key);
              } else if (e.key === "Escape") {
                setOpen(false);
                inputRef.current?.blur();
              }
            }}
            className="w-full border-b border-[#b3bbc0] bg-transparent py-1 text-[21px] text-arm-dark outline-none placeholder:text-[#7d878d] focus:border-arm-blue"
          />
          {results.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-40 max-h-80 overflow-y-auto border border-[#c9ced1] bg-white shadow-lg" role="listbox">
              {results.map((w, i) => (
                <li key={w.key} role="option" aria-selected={i === active}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => add(w.key)}
                    className={`w-full px-4 py-2.5 text-left text-[14.5px] ${i === active ? "bg-[#e8f2f9]" : "hover:bg-[#f3f5f6]"}`}
                  >
                    {w.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {first && (
          <>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-3">
              {FREQUENT_KEYS.map((k) => (
                <button key={k} type="button" className="arm-btn text-[14.5px]" disabled={p.readOnly} onClick={() => add(k)}>
                  {whatHappened(k)?.name}
                </button>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px] text-arm-desc" data-hk="Alt+R">
              Значимые типы происшествий:
              {SIGNIFICANT_KEYS.map((k, i) => (
                <button
                  key={k}
                  id={i === 0 ? "op112-significant" : undefined}
                  type="button"
                  className="arm-btn"
                  disabled={p.readOnly}
                  onClick={() => add(k)}
                >
                  {whatHappened(k)?.chip}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      {!first && (
        <div className="flex shrink-0 flex-wrap gap-2 bg-arm-panel px-3 py-2">
          {p.cards.map((k) => (
            <button
              key={k}
              type="button"
              title={p.readOnly ? undefined : "Снять тип"}
              onClick={() => remove(k)}
              className="border border-[#9aa3a9] bg-white px-3 py-1 text-[13px] hover:border-arm-dark"
            >
              {whatHappened(k)?.chip ?? k}
            </button>
          ))}
        </div>
      )}
      {p.cards.map((k, i) => (
        <QuestionCardView
          key={k}
          index={i}
          cardKey={k}
          answers={p.answers[k] ?? {}}
          readOnly={p.readOnly}
          onChange={(a) => setAnswers(k, a)}
          onClose={() => remove(k)}
        />
      ))}
    </>
  );
}

function QuestionCardView(p: {
  cardKey: string;
  index: number;
  answers: CardAnswers;
  readOnly: boolean;
  onChange: (a: CardAnswers) => void;
  onClose: () => void;
}) {
  const card = questionCard(p.cardKey);
  const rows = card.rows.filter((r) => rowVisible(r, p.answers));
  const choose = (row: QuestionRow, value: string) => {
    if (p.readOnly) return;
    const cur = p.answers[row.id] ?? [];
    let next: string[];
    if (row.kind === "multi") next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    else next = cur.includes(value) ? [] : [value];
    p.onChange({ ...p.answers, [row.id]: next });
  };
  return (
    <section className="shrink-0 bg-white" id={`op112-card-${p.index + 1}`} data-hk={p.index < 9 ? `Alt+${p.index + 1}` : undefined}>
      <div className="flex items-center justify-between bg-arm-dark px-3 py-1.5 text-white">
        <h3 className="text-[14px] font-bold underline decoration-dotted underline-offset-4">{card.title}</h3>
        {!p.readOnly && (
          <button type="button" title="Снять тип" onClick={p.onClose} className="p-0.5 hover:text-arm-orange">
            <IconClose className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="flex flex-col py-1">
        {rows.map((row) => (
          <div key={row.id} data-row={row.id} className="grid grid-cols-[minmax(160px,300px)_1fr] items-start gap-3 px-3 py-1.5">
            <div className="pt-1.5 text-[13.5px] text-arm-desc">{row.label}</div>
            {row.kind === "text" ? (
              <input
                aria-label={row.label}
                value={(p.answers[row.id] ?? [])[0] ?? ""}
                readOnly={p.readOnly}
                onChange={(e) => p.onChange({ ...p.answers, [row.id]: e.target.value ? [e.target.value] : [] })}
                className="arm-field max-w-[520px]"
              />
            ) : (
              <div className="flex flex-wrap gap-2" role="group" aria-label={row.label}>
                {(row.options ?? []).map((o) => (
                  <button
                    key={o}
                    type="button"
                    className="arm-btn"
                    aria-pressed={(p.answers[row.id] ?? []).includes(o)}
                    disabled={p.readOnly}
                    onClick={() => choose(row, o)}
                  >
                    {o}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
