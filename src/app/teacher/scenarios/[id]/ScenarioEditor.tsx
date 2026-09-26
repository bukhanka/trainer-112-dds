"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Badge, Button, inputClass } from "@/components/ui";
import { SECTIONS, TEMPERS, type SectionKey } from "@/lib/scenarios/sections";
import { CallerView, DdsCardView, DdsReferenceView, TruthView } from "./views";

export type EditorScenario = {
  id: string;
  title: string;
  category: string;
  difficulty: number;
  status: "DRAFT" | "APPROVED" | "ARCHIVED";
  approvedSections: string[];
  present: SectionKey[];
  caller: unknown;
  truth: unknown;
  ddsCard: unknown;
  ddsReference: unknown;
  teacherNote: string | null;
};

type Mode = { section: SectionKey; kind: "edit" | "fix" } | null;

const VIEW: Record<SectionKey, (p: { value: unknown }) => ReactNode> = {
  caller: CallerView,
  truth: TruthView,
  ddsCard: DdsCardView,
  ddsReference: DdsReferenceView,
};

async function call(url: string, body: unknown, method: "POST" | "PATCH"): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    return res.ok ? { ok: true } : { ok: false, error: data.error ?? "Не получилось" };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

export function ScenarioEditor({ s, lockedBy, aiMock, categories }: { s: EditorScenario; lockedBy: string | null; aiMock: boolean; categories: string[] }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [meta, setMeta] = useState({ title: s.title, category: s.category, difficulty: s.difficulty, editing: false });
  const base = `/api/teacher/scenarios/${s.id}`;
  const archived = s.status === "ARCHIVED";
  const lockText = lockedBy ? `Сценарий может выпасть в идущем занятии «${lockedBy}». Править и снимать утверждение можно после его окончания.` : null;

  async function run(url: string, body: unknown, done: string) {
    setBusy(true);
    setMessage(null);
    // Plain edits go to the scenario itself (PATCH); approvals, archive and «исправь» are actions (POST).
    const r = await call(url, body, url === base ? "PATCH" : "POST");
    setBusy(false);
    setMessage(r.ok ? { ok: true, text: done } : { ok: false, text: r.error ?? "Ошибка" });
    if (r.ok) setMode(null);
    // Even a refused «исправь» keeps the remark in the teacher's note, so the page is re-read either way.
    router.refresh();
    return r.ok;
  }

  const approvedCount = s.present.filter((k) => s.approvedSections.includes(k)).length;

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded border border-arm-gray/70 bg-white p-4">
        {meta.editing ? (
          <div className="grid gap-3 sm:grid-cols-[1fr_12rem_8rem_auto] sm:items-end">
            <label className="flex flex-col gap-1 text-sm">
              Название
              <input className={inputClass} value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Категория
              <input className={inputClass} list="categories" value={meta.category} onChange={(e) => setMeta({ ...meta, category: e.target.value })} />
              <datalist id="categories">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Сложность 1–10
              <input type="number" min={1} max={10} className={inputClass} value={meta.difficulty} onChange={(e) => setMeta({ ...meta, difficulty: Math.min(10, Math.max(1, Number(e.target.value) || 1)) })} />
            </label>
            <div className="flex gap-2">
              <Button variant="primary" disabled={busy} onClick={async () => (await run(base, { title: meta.title, category: meta.category, difficulty: meta.difficulty }, "Сохранено")) && setMeta((m) => ({ ...m, editing: false }))}>
                Сохранить
              </Button>
              <Button onClick={() => setMeta({ title: s.title, category: s.category, difficulty: s.difficulty, editing: false })}>Отмена</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={s.status === "APPROVED" ? "green" : s.status === "ARCHIVED" ? "neutral" : "amber"}>
              {s.status === "APPROVED" ? "Утверждён" : s.status === "ARCHIVED" ? "В архиве" : "Черновик"}
            </Badge>
            <span className="text-sm text-arm-desc">
              {s.category} · сложность {s.difficulty} · разделов утверждено {approvedCount} из {s.present.length}
            </span>
            <div className="ml-auto flex flex-wrap gap-2">
              {!archived && (
                <Button size="sm" variant="ghost" disabled={Boolean(lockedBy)} onClick={() => setMeta({ ...meta, editing: true })}>
                  Изменить название и сложность
                </Button>
              )}
              {!archived && s.status !== "APPROVED" && (
                <Button size="sm" variant="success" disabled={busy} onClick={() => run(`${base}/approve`, { sections: "all", approve: true }, "Сценарий утверждён целиком")}>
                  ✓ Утвердить целиком
                </Button>
              )}
              {!archived && approvedCount > 0 && (
                <Button size="sm" disabled={busy || Boolean(lockedBy)} onClick={() => run(`${base}/approve`, { sections: "all", approve: false }, "Утверждение снято")}>
                  Снять утверждение
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || (!archived && Boolean(lockedBy))}
                onClick={() => (archived || window.confirm("Убрать сценарий в архив? Он перестанет попадать в занятия.")) && run(`${base}/archive`, { archived: !archived }, archived ? "Возвращён из архива черновиком" : "Убран в архив")}
              >
                {archived ? "Вернуть из архива" : "В архив"}
              </Button>
            </div>
          </div>
        )}
        {lockText && <p className="mt-2 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">{lockText}</p>}
      </section>
      {message && (
        <div
          role="status"
          className={`fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-xl items-start gap-3 rounded border p-3 text-sm shadow-lg ${message.ok ? "border-emerald-300 bg-emerald-50 text-emerald-900" : "border-red-300 bg-red-50 text-red-800"}`}
        >
          <span className="flex-1">{message.text}</span>
          <button type="button" className="text-arm-desc hover:text-arm-dark" aria-label="Закрыть" onClick={() => setMessage(null)}>
            ✕
          </button>
        </div>
      )}

      {SECTIONS.map((sec) => {
        const value = s[sec.key];
        const present = s.present.includes(sec.key);
        const approved = s.approvedSections.includes(sec.key);
        const View = VIEW[sec.key];
        const editing = mode?.section === sec.key && mode.kind === "edit";
        const fixing = mode?.section === sec.key && mode.kind === "fix";
        return (
          <section key={sec.key} className={`rounded border-2 bg-white ${approved ? "border-emerald-600/60" : "border-arm-gray/70"}`}>
            <header className="flex flex-wrap items-center gap-2 border-b border-arm-gray/60 px-4 py-2">
              <h2 className="text-base font-semibold">{sec.title}</h2>
              {present ? <Badge tone={approved ? "green" : "amber"}>{approved ? "утверждён" : "черновик"}</Badge> : <Badge>пусто</Badge>}
              <span className="w-full text-xs text-arm-desc sm:w-auto">{sec.hint}</span>
              {!archived && present && (
                <div className="ml-auto flex flex-wrap gap-2">
                  {approved ? (
                    <Button size="sm" disabled={busy || Boolean(lockedBy)} onClick={() => run(`${base}/approve`, { sections: [sec.key], approve: false }, `Снято утверждение: ${sec.title}`)}>
                      Снять утверждение
                    </Button>
                  ) : (
                    <Button size="sm" variant="success" disabled={busy} onClick={() => run(`${base}/approve`, { sections: [sec.key], approve: true }, `Утверждено: ${sec.title}`)}>
                      ✓ Утвердить раздел
                    </Button>
                  )}
                  <Button size="sm" disabled={busy || Boolean(lockedBy)} onClick={() => setMode(editing ? null : { section: sec.key, kind: "edit" })}>
                    Изменить
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy || Boolean(lockedBy)} onClick={() => setMode(fixing ? null : { section: sec.key, kind: "fix" })}>
                    Исправь…
                  </Button>
                </div>
              )}
            </header>
            <div className="p-4">
              {editing ? (
                sec.key === "caller" ? (
                  <CallerForm value={value} busy={busy} onCancel={() => setMode(null)} onSave={(v) => run(base, { caller: v }, "Заявитель сохранён")} />
                ) : (
                  <JsonForm value={value} busy={busy} onCancel={() => setMode(null)} onSave={(v) => run(base, { [sec.key]: v }, `${sec.title}: сохранено`)} />
                )
              ) : present ? (
                <View value={value} />
              ) : (
                <p className="text-sm text-arm-desc">Раздел не заполнен.</p>
              )}
              {fixing && (
                <FixForm
                  aiMock={aiMock}
                  busy={busy}
                  onCancel={() => setMode(null)}
                  onSend={(comment) => run(`${base}/regenerate`, { section: sec.key, comment }, `${sec.title}: ИИ переписал раздел, он снова черновик — проверьте и утвердите`)}
                />
              )}
            </div>
          </section>
        );
      })}

      {s.teacherNote && (
        <section className="rounded border border-arm-gray/70 bg-white p-4">
          <h2 className="mb-2 text-base font-semibold">Замечания преподавателей</h2>
          <pre className="whitespace-pre-wrap font-sans text-sm">{s.teacherNote}</pre>
        </section>
      )}
    </div>
  );
}

function FixForm({ aiMock, busy, onSend, onCancel }: { aiMock: boolean; busy: boolean; onSend: (comment: string) => void; onCancel: () => void }) {
  const [comment, setComment] = useState("");
  return (
    <div className="mt-3 flex flex-col gap-2 rounded border-2 border-arm-blue/60 bg-arm-blue/5 p-3">
      <label className="text-sm font-medium" htmlFor="fix">
        Что исправить? ИИ перепишет раздел с учётом замечания, раздел вернётся черновиком.
      </label>
      <textarea
        id="fix"
        className="min-h-20 rounded border border-arm-gray bg-white p-2 text-sm outline-none focus:border-arm-blue"
        placeholder="Например: заявитель пожилой, говорит сбивчиво; адрес называет только после второго вопроса"
        value={comment}
        maxLength={2000}
        onChange={(e) => setComment(e.target.value)}
      />
      {aiMock && <p className="text-xs text-amber-800">Модель ИИ не подключена: замечание сохранится в заметке, а раздел нужно будет поправить вручную.</p>}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" disabled={busy || comment.trim().length < 3} onClick={() => onSend(comment.trim())}>
          {aiMock ? "Сохранить замечание" : "Исправить с ИИ"}
        </Button>
        <Button size="sm" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

function JsonForm({ value, busy, onSave, onCancel }: { value: unknown; busy: boolean; onSave: (v: unknown) => void; onCancel: () => void }) {
  const [text, setText] = useState(() => JSON.stringify(value ?? {}, null, 2));
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-arm-desc">Раздел хранится как JSON: меняйте значения, сохраняя поля. Проверка формата — при сохранении.</p>
      <textarea
        className="min-h-80 rounded border border-arm-gray bg-white p-2 font-mono text-xs outline-none focus:border-arm-blue"
        value={text}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
        aria-label="Содержимое раздела в JSON"
      />
      {error && <p className="text-sm text-red-700">{error}</p>}
      <div className="flex gap-2">
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={() => {
            try {
              const parsed = JSON.parse(text);
              if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("нужен объект { … }");
              setError(null);
              onSave(parsed);
            } catch (e) {
              setError(`Неверный JSON: ${e instanceof Error ? e.message : ""}`);
            }
          }}
        >
          Сохранить
        </Button>
        <Button size="sm" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

type CallerFields = { fullName: string; role: string; phone: string; visibleAddress: string; hiddenAddress: string; situation: string; facts: string; temper: string; voice: string };

function CallerForm({ value, busy, onSave, onCancel }: { value: unknown; busy: boolean; onSave: (v: Record<string, unknown>) => void; onCancel: () => void }) {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof v[k] === "string" ? (v[k] as string) : "");
  const [f, setF] = useState<CallerFields>({
    fullName: s("fullName"),
    role: s("role"),
    phone: s("phone"),
    visibleAddress: s("visibleAddress"),
    hiddenAddress: s("hiddenAddress"),
    situation: s("situation"),
    facts: Array.isArray(v.facts) ? (v.facts as unknown[]).filter((x) => typeof x === "string").join("\n") : "",
    temper: s("temper"),
    voice: s("voice"),
  });
  const set = (k: keyof CallerFields) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1 text-sm">
        ФИО
        <input className={inputClass} value={f.fullName} onChange={set("fullName")} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Кто он (очевидец, мама, водитель…)
        <input className={inputClass} value={f.role} onChange={set("role")} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Телефон
        <input className={inputClass} value={f.phone} onChange={set("phone")} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-sm">
          Характер
          <select className={inputClass} value={f.temper} onChange={set("temper")}>
            <option value="">—</option>
            {Object.entries(TEMPERS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Голос
          <select className={inputClass} value={f.voice} onChange={set("voice")}>
            <option value="">—</option>
            <option value="female">женский</option>
            <option value="male">мужской</option>
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        Что говорит сразу
        <textarea className="min-h-16 rounded border border-arm-gray p-2 text-sm outline-none focus:border-arm-blue" value={f.situation} onChange={set("situation")} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Адрес, который называет сразу
        <input className={inputClass} value={f.visibleAddress} onChange={set("visibleAddress")} />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Точный адрес — только если спросить
        <input className={inputClass} value={f.hiddenAddress} onChange={set("hiddenAddress")} />
      </label>
      <label className="flex flex-col gap-1 text-sm sm:col-span-2">
        Факты — по одному в строке, отвечает только на вопрос
        <textarea className="min-h-24 rounded border border-arm-gray p-2 text-sm outline-none focus:border-arm-blue" value={f.facts} onChange={set("facts")} />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <Button
          variant="primary"
          size="sm"
          disabled={busy}
          onClick={() =>
            onSave({
              ...v,
              fullName: f.fullName,
              role: f.role,
              phone: f.phone || undefined,
              visibleAddress: f.visibleAddress,
              hiddenAddress: f.hiddenAddress || undefined,
              situation: f.situation,
              facts: f.facts
                .split("\n")
                .map((x) => x.trim())
                .filter(Boolean),
              temper: f.temper || undefined,
              voice: f.voice || undefined,
            })
          }
        >
          Сохранить
        </Button>
        <Button size="sm" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}
