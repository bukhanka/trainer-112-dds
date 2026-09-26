"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge, Button, inputClass } from "@/components/ui";
import type { StudentOption } from "@/lib/teacher/groups";

type Teacher = { id: string; fullName: string };
type Sent = { ok: true; data: Record<string, unknown> } | { ok: false; error: string };

const DEMO_HINT = "Демо-группу на стенде менять нельзя: создайте свою группу";

async function send(url: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<Sent> {
  try {
    const res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) return { ok: false, error: typeof data.error === "string" ? data.error : "Не получилось" };
    return { ok: true, data };
  } catch {
    return { ok: false, error: "Нет связи с сервером" };
  }
}

function ErrorLine({ text }: { text: string | null }) {
  return text ? (
    <p role="alert" className="w-full text-sm text-red-700">
      {text}
    </p>
  ) : null;
}

/** «Новая группа»: one line, always open — a teacher sees at once where to start. */
export function NewGroupForm({ teachers }: { teachers: Teacher[] | null }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [teacherId, setTeacherId] = useState(teachers?.[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await send("/api/teacher/groups", "POST", { name, ...(teachers ? { teacherId: teacherId || null } : {}) });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setName("");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 rounded border border-arm-gray/70 bg-white p-3">
      <label className="flex min-w-60 flex-[2] flex-col gap-1 text-sm">
        Новая группа
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Например: Группа № 2, октябрь" className={inputClass} />
      </label>
      {teachers && (
        <label className="flex min-w-52 flex-1 flex-col gap-1 text-sm">
          Преподаватель
          <select value={teacherId} onChange={(e) => setTeacherId(e.target.value)} className={inputClass}>
            <option value="">— не назначен —</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.fullName}
              </option>
            ))}
          </select>
        </label>
      )}
      <Button type="submit" variant="primary" disabled={busy || name.trim().length < 2}>
        Создать группу
      </Button>
      <ErrorLine text={error} />
    </form>
  );
}

/** Rename and archive; the administrator also names the teacher. */
export function GroupActions({ group, teachers, locked }: { group: { id: string; name: string; teacherId: string | null }; teachers: Teacher[] | null; locked: boolean }) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(group.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    const res = await send(`/api/teacher/groups/${group.id}`, "PATCH", body);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    router.refresh();
    return true;
  }

  if (renaming) {
    return (
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (await patch({ name })) setRenaming(false);
        }}
        className="flex flex-wrap items-center gap-2"
      >
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Новое название группы" className={`${inputClass} h-8! w-64!`} />
        <Button type="submit" size="sm" variant="primary" disabled={busy || name.trim().length < 2}>
          Сохранить
        </Button>
        <Button
          size="sm"
          onClick={() => {
            setRenaming(false);
            setName(group.name);
            setError(null);
          }}
        >
          Отмена
        </Button>
        <ErrorLine text={error} />
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {teachers && (
        <label className="flex items-center gap-1.5 text-sm text-arm-desc">
          Преподаватель
          <select
            value={group.teacherId ?? ""}
            disabled={busy || locked}
            title={locked ? DEMO_HINT : undefined}
            onChange={(e) => void patch({ teacherId: e.target.value || null })}
            className="h-8 rounded border border-arm-gray bg-white px-2 text-sm text-arm-dark"
          >
            <option value="">— не назначен —</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.fullName}
              </option>
            ))}
          </select>
        </label>
      )}
      <Button size="sm" disabled={busy || locked} title={locked ? DEMO_HINT : undefined} onClick={() => setRenaming(true)}>
        Переименовать
      </Button>
      <Button
        size="sm"
        variant="ghost"
        disabled={busy || locked}
        title={locked ? DEMO_HINT : "Курс закончился: группа уйдёт из формы занятия и прогнозов, история останется"}
        onClick={() => {
          if (window.confirm(`Убрать группу «${group.name}» в архив? Она пропадёт из формы занятия и прогнозов, история успеваемости останется. Вернуть можно в любой момент.`)) {
            void patch({ archived: true });
          }
        }}
      >
        В архив
      </Button>
      <ErrorLine text={error} />
    </div>
  );
}

export function RestoreGroup({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const res = await send(`/api/teacher/groups/${id}`, "PATCH", { archived: false });
          setBusy(false);
          if (!res.ok) setError(res.error);
          else router.refresh();
        }}
        aria-label={`Вернуть из архива: ${name}`}
      >
        Вернуть из архива
      </Button>
      <ErrorLine text={error} />
    </span>
  );
}

/** «Убрать» in a student's row. Results stay; a place in the group's draft lessons goes too. */
export function RemoveMember({ groupId, student, locked }: { groupId: string; student: { id: string; fullName: string }; locked: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-end">
      <button
        type="button"
        disabled={busy || locked}
        title={locked ? DEMO_HINT : "Убрать ученика из группы"}
        onClick={async () => {
          if (!window.confirm(`Убрать из группы: ${student.fullName}? Результаты ученика сохранятся. Место в черновиках занятий этой группы тоже уберётся.`)) return;
          setBusy(true);
          setError(null);
          const res = await send(`/api/teacher/groups/${groupId}/members/${student.id}`, "DELETE");
          setBusy(false);
          if (!res.ok) setError(res.error);
          else router.refresh();
        }}
        className="rounded px-1.5 py-0.5 text-xs text-arm-blue hover:bg-arm-blue/10 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Убрать
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  );
}

/** «Добавить учеников»: search by name or login among active students; those without a group come first. */
export function AddStudents({ groupId }: { groupId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [list, setList] = useState<StudentOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [added, setAdded] = useState<string[]>([]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(
      async () => {
        try {
          const res = await fetch(`/api/teacher/students?groupId=${encodeURIComponent(groupId)}&q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
          const data = (await res.json().catch(() => ({}))) as { students?: StudentOption[]; error?: string };
          if (!alive) return;
          if (!res.ok) setError(data.error ?? "Не получилось загрузить список");
          else {
            setError(null);
            setList(data.students ?? []);
          }
        } catch {
          if (alive) setError("Нет связи с сервером");
        }
      },
      q ? 300 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, q, groupId]);

  async function add(s: StudentOption) {
    setBusyId(s.id);
    setError(null);
    const res = await send(`/api/teacher/groups/${groupId}/members`, "POST", { userId: s.id });
    setBusyId(null);
    if (!res.ok) return setError(res.error);
    setAdded((a) => [...a, s.fullName]);
    setList((l) => l?.filter((x) => x.id !== s.id) ?? l);
    router.refresh();
  }

  if (!open) {
    return (
      <Button size="sm" variant="primary" onClick={() => setOpen(true)}>
        + Добавить учеников
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-arm-blue/40 bg-arm-blue/5 p-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-60 flex-1 flex-col gap-1 text-sm">
          Найти ученика
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Фамилия, имя или логин" className={inputClass} />
        </label>
        <Button
          onClick={() => {
            setOpen(false);
            setQ("");
            setAdded([]);
          }}
        >
          Готово
        </Button>
      </div>
      {added.length > 0 && <p className="text-sm text-emerald-800">Добавлены: {added.join(", ")}.</p>}
      <ErrorLine text={error} />
      {list == null ? (
        <p className="text-sm text-arm-desc">Загрузка…</p>
      ) : list.length ? (
        <ul className="max-h-72 divide-y divide-arm-gray/50 overflow-y-auto rounded border border-arm-gray/60 bg-white">
          {list.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{s.fullName}</span> <span className="text-xs text-arm-desc">· {s.login}</span>
                <span className="mt-0.5 block text-xs">
                  {s.noGroup ? <Badge tone="amber">без группы</Badge> : s.groups.length ? <span className="text-arm-desc">в группах: {s.groups.join(", ")}</span> : <span className="text-arm-desc">в группе другого преподавателя</span>}
                </span>
              </span>
              <Button size="sm" variant="primary" disabled={busyId !== null} onClick={() => void add(s)}>
                Добавить
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-arm-desc">{q.trim() ? "Никого не нашли. Нового ученика создаёт администратор в разделе «Пользователи»." : "Все ученики уже в этой группе."}</p>
      )}
      <p className="text-xs text-arm-desc">Показаны активные учётные записи обучающихся; сначала — те, кто ещё не в группе. Ученик может быть в нескольких группах.</p>
    </div>
  );
}
