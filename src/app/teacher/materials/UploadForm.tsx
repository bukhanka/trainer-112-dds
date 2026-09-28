"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { buttonClass, fieldClass, inputClass } from "@/components/ui";

export type LessonOption = { id: string; label: string };
type Audience = "all" | "lesson" | "staff";

const AUDIENCES: { value: Audience; label: string; hint: string }[] = [
  { value: "all", label: "Всем обучающимся", hint: "памятки и инструкции для всех" },
  { value: "lesson", label: "Ученикам занятия", hint: "видят ученики этого занятия и его группы" },
  { value: "staff", label: "Только преподавателям", hint: "методика, эталоны, ключи — ученики не видят" },
];

const stem = (name: string) => name.replace(/\.[^.]+$/, "").replace(/_+/g, " ").trim();

/** Upload of a material: the file, its name and who sees it. The server checks everything again. */
export function UploadForm({ lessons, maxMb, accept, kinds }: { lessons: LessonOption[]; maxMb: number; accept: string; kinds: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [autoTitle, setAutoTitle] = useState(true);
  const [audience, setAudience] = useState<Audience>("all");
  const [lessonId, setLessonId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const allowed = accept.split(",");

  function pick(f: File | null) {
    setError(null);
    setDone(null);
    setFile(f);
    setFileError(null);
    if (!f) return;
    const ext = f.name.includes(".") ? `.${f.name.split(".").pop()!.toLowerCase()}` : "";
    if (!allowed.includes(ext)) setFileError(`Файлы ${ext || "без расширения"} не принимаются. Можно: ${kinds}`);
    else if (f.size > maxMb * 1024 * 1024) setFileError(`Файл больше ${maxMb} МБ — уменьшите его или разделите на части`);
    if (autoTitle || !title) {
      setTitle(stem(f.name));
      setAutoTitle(true);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return setError("Выберите файл");
    if (audience === "lesson" && !lessonId) return setError("Выберите занятие");
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("title", title);
      body.append("audience", audience);
      if (audience === "lesson") body.append("lessonId", lessonId);
      const res = await fetch("/api/materials", { method: "POST", body });
      const data = (await res.json().catch(() => ({}))) as { error?: string; title?: string };
      if (!res.ok) {
        setError(data.error ?? (res.status === 413 ? `Файл больше ${maxMb} МБ` : "Не удалось загрузить файл"));
        return;
      }
      setDone(`Загружено: «${data.title ?? title}»`);
      setFile(null);
      setTitle("");
      setAutoTitle(true);
      formRef.current?.reset();
      router.refresh();
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} onSubmit={submit} className="flex flex-col gap-3 text-sm">
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          Файл
          <span className="flex flex-wrap items-center gap-2">
            <input type="file" accept={accept} onChange={(e) => pick(e.currentTarget.files?.[0] ?? null)} className="peer sr-only" />
            <span className={`${buttonClass("secondary")} cursor-pointer peer-focus-visible:ring-2 peer-focus-visible:ring-arm-blue/50`}>Выбрать файл</span>
            <span className="min-w-0 break-all text-arm-desc">{file ? file.name : "файл не выбран"}</span>
          </span>
          <span className="text-xs text-arm-desc">
            {kinds}, до {maxMb} МБ
          </span>
        </label>
        <label className="flex flex-col gap-1">
          Название
          <input
            value={title}
            maxLength={200}
            onChange={(e) => {
              setTitle(e.target.value);
              setAutoTitle(false);
            }}
            placeholder="Например: Памятка диспетчера ДДС"
            className={inputClass}
          />
        </label>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1">Кому видно</legend>
        {AUDIENCES.map((a) => (
          <label key={a.value} className="flex flex-wrap items-center gap-2">
            <input
              type="radio"
              name="audience"
              value={a.value}
              checked={audience === a.value}
              onChange={() => {
                setAudience(a.value);
                setError(null);
              }}
            />
            <span className="font-medium">{a.label}</span>
            <span className="text-xs text-arm-desc">— {a.hint}</span>
          </label>
        ))}
        {audience === "lesson" && (
          <select
            value={lessonId}
            onChange={(e) => {
              setLessonId(e.target.value);
              setError(null);
            }}
            className={`${fieldClass} ml-6 h-10 max-w-xl`}
            aria-label="Занятие"
          >
            <option value="">{lessons.length ? "Выберите занятие…" : "Занятий пока нет — создайте занятие"}</option>
            {lessons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
        )}
      </fieldset>
      {(fileError || error) && (
        <p role="alert" className="text-arm-late">
          {fileError ?? error}
        </p>
      )}
      {done && <p className="text-emerald-800">{done}</p>}
      <button disabled={busy || !file || !!fileError} className={`${buttonClass("primary")} self-start`}>
        {busy ? "Загружаю…" : "Загрузить"}
      </button>
    </form>
  );
}
