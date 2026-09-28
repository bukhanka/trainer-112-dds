"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { Button, buttonClass } from "@/components/ui";
import { createDraftFromTicket } from "./ticket-actions";

type Fragment = { label: string; text: string; long: boolean };
type Parsed = { fileName: string; tickets: number; fragments: Fragment[]; notes: string[] };
type Made = { id: string; title: string } | { error: string } | "busy";

const MAX_MB = 20;
const LIMIT = 2000;

function plural(n: number, one: string, few: string, many: string) {
  const a = n % 100;
  const b = n % 10;
  return a > 10 && a < 20 ? many : b === 1 ? one : b > 1 && b < 5 ? few : many;
}

/**
 * «Сценарий из билета» on the «Сценарий из текста» form: a ticket file (DOCX, TXT, PDF with text) is read on the
 * server and cut into situations. One situation goes straight into the text field; several are listed — each can
 * go into the field or become a draft right here, or all of them one after another.
 */
export function TicketFile() {
  const box = useRef<HTMLDivElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const stop = useRef(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [made, setMade] = useState<Record<number, Made>>({});
  const [batch, setBatch] = useState<{ done: number; total: number } | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);

  const form = () => box.current?.closest("form") ?? null;
  const field = <T extends Element>(name: string) => (form()?.elements.namedItem(name) as T | null) ?? null;

  function putInField(f: Fragment, note: string) {
    const area = field<HTMLTextAreaElement>("text");
    if (!area) return;
    area.value = f.text.slice(0, LIMIT);
    area.focus();
    area.scrollIntoView({ block: "center", behavior: "smooth" });
    setPlaced(note);
  }

  async function read(file: File) {
    setError(null);
    setParsed(null);
    setMade({});
    setPlaced(null);
    if (file.size > MAX_MB * 1024 * 1024) {
      setError(`Файл больше ${MAX_MB} МБ — сохраните билеты отдельным файлом без картинок`);
      return;
    }
    setReading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/teacher/scenarios/from-file", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as Parsed & { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Не удалось прочитать файл");
        return;
      }
      setParsed(data);
      if (data.fragments.length === 1) putInField(data.fragments[0], `Текст из файла «${data.fileName}» — в поле ниже. Проверьте его и нажмите «Создать черновик сценария».`);
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setReading(false);
      if (picker.current) picker.current.value = "";
    }
  }

  async function make(i: number): Promise<boolean> {
    if (!parsed) return false;
    const f = parsed.fragments[i];
    const difficulty = Number(field<HTMLSelectElement>("difficulty")?.value) || undefined;
    setMade((m) => ({ ...m, [i]: "busy" }));
    try {
      const res = await createDraftFromTicket({ text: f.text.slice(0, LIMIT), label: f.label, fileName: parsed.fileName, difficulty });
      setMade((m) => ({ ...m, [i]: res.ok ? { id: res.id, title: res.title } : { error: res.error } }));
      return res.ok;
    } catch {
      setMade((m) => ({ ...m, [i]: { error: "Нет связи с сервером" } }));
      return false;
    }
  }

  async function makeAll() {
    if (!parsed) return;
    const todo = parsed.fragments.map((_, i) => i).filter((i) => !(made[i] && typeof made[i] === "object" && "id" in (made[i] as object)));
    stop.current = false;
    setBatch({ done: 0, total: todo.length });
    for (const [k, i] of todo.entries()) {
      if (stop.current) break;
      await make(i);
      setBatch({ done: k + 1, total: todo.length });
    }
    setBatch(null);
  }

  const several = parsed && parsed.fragments.length > 1;
  const createdCount = Object.values(made).filter((m) => typeof m === "object" && "id" in m).length;

  return (
    <div ref={box} className="flex flex-col gap-2 rounded border border-dashed border-arm-gray bg-arm-panel/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Сценарий из билета</span>
        <label className={`${buttonClass("secondary", "sm")} cursor-pointer ${reading ? "pointer-events-none opacity-50" : ""}`}>
          {reading ? "Читаю файл…" : "Загрузить файл билета"}
          <input
            ref={picker}
            type="file"
            accept=".docx,.txt,.pdf"
            className="sr-only"
            disabled={reading}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) void read(file);
            }}
          />
        </label>
        <span className="text-xs text-arm-desc">DOCX, TXT или PDF с текстом, до {MAX_MB} МБ. Файл только читается и не сохраняется.</span>
      </div>

      {error && (
        <p role="alert" className="text-arm-late">
          {error}
        </p>
      )}
      {placed && !several && <p className="text-emerald-800">{placed}</p>}

      {parsed && (
        <>
          {several && (
            <p>
              В файле «{parsed.fileName}»
              {parsed.tickets > 0 && ` ${parsed.tickets} ${plural(parsed.tickets, "билет", "билета", "билетов")},`} {parsed.fragments.length}{" "}
              {plural(parsed.fragments.length, "ситуация", "ситуации", "ситуаций")}. Один сценарий — одна ситуация: подставьте нужную в поле или создайте черновики
              прямо здесь.
            </p>
          )}
          {parsed.notes.map((n) => (
            <p key={n} className="text-amber-800">
              {n}
            </p>
          ))}
          {placed && several && <p className="text-emerald-800">{placed}</p>}
          {several && (
            <ol className="flex max-h-96 flex-col gap-2 overflow-y-auto pr-1">
              {parsed.fragments.map((f, i) => {
                const state = made[i];
                return (
                  <li key={i} className="rounded border border-arm-gray/70 bg-white p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <b>{f.label}</b>
                      {f.long && <span className="text-xs text-amber-800">длиннее {LIMIT} символов</span>}
                      <span className="ml-auto flex flex-wrap gap-1">
                        <Button size="sm" variant="ghost" onClick={() => putInField(f, `В поле — «${f.label}». Проверьте текст и нажмите «Создать черновик сценария».`)}>
                          В поле
                        </Button>
                        {state && typeof state === "object" && "id" in state ? null : (
                          <Button size="sm" disabled={state === "busy" || !!batch} onClick={() => void make(i)}>
                            {state === "busy" ? "Собираю…" : "Создать черновик"}
                          </Button>
                        )}
                      </span>
                    </div>
                    <p className="mt-1 line-clamp-3 whitespace-pre-line text-arm-desc">{f.text}</p>
                    {state && typeof state === "object" && "id" in state && (
                      <p className="mt-1 text-emerald-800">
                        ✓ Черновик «{state.title}» —{" "}
                        <Link href={`/teacher/scenarios/${state.id}`} target="_blank" className="text-arm-blue hover:underline">
                          открыть
                        </Link>
                      </p>
                    )}
                    {state && typeof state === "object" && "error" in state && (
                      <p role="alert" className="mt-1 text-arm-late">
                        {state.error}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
          {several && (
            <div className="flex flex-wrap items-center gap-2">
              {batch ? (
                <>
                  <span>
                    Собираю черновики: {batch.done} из {batch.total}…
                  </span>
                  <Button size="sm" onClick={() => (stop.current = true)}>
                    Остановить
                  </Button>
                </>
              ) : (
                createdCount < parsed.fragments.length && (
                  <Button size="sm" variant="primary" onClick={() => void makeAll()}>
                    Создать черновики по всем ({parsed.fragments.length - createdCount})
                  </Button>
                )
              )}
              {createdCount > 0 && (
                <Link href="/teacher/scenarios?status=DRAFT" className="text-arm-blue hover:underline">
                  Черновики на утверждение →
                </Link>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
