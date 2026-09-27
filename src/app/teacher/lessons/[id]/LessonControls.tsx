"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, LinkButton } from "@/components/ui";

type Status = "DRAFT" | "RUNNING" | "FINISHED";

/**
 * Start / stop / copy / delete. Every action is confirmed and audited on the server.
 * startBlocked — why the lesson cannot start yet (places would get no cards); the server checks it again.
 */
export function LessonControls({ id, status, onChanged, startBlocked }: { id: string; status: Status; onChanged?: () => void; startBlocked?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(path: string, method: "POST" | "DELETE", confirmText: string, after?: (data: { id?: string }) => void) {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/teacher/lessons/${id}${path}`, { method });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok) {
        setError(data.error ?? "Не получилось");
        return;
      }
      if (after) after(data);
      else {
        onChanged?.();
        router.refresh();
      }
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap justify-end gap-2">
        {status === "DRAFT" && (
          <>
            <Button
              variant="success"
              disabled={busy || Boolean(startBlocked)}
              title={startBlocked ?? undefined}
              onClick={() => call("/start", "POST", "Начать занятие? После старта места, задания и настройки менять нельзя.")}
            >
              ▶ Начать занятие
            </Button>
            <LinkButton href={`/teacher/lessons/${id}/edit`}>Изменить</LinkButton>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => call("", "DELETE", "Удалить черновик занятия?", () => router.push("/teacher"))}
            >
              Удалить
            </Button>
          </>
        )}
        {status === "RUNNING" && (
          <Button variant="danger" disabled={busy} onClick={() => call("/stop", "POST", "Завершить занятие для всего класса? Карточки перестанут приходить.")}>
            ■ Завершить занятие
          </Button>
        )}
        {status === "FINISHED" && (
          <Button
            disabled={busy}
            onClick={() => call("/copy", "POST", "Создать новое занятие с теми же местами и заданиями?", (d) => d.id && router.push(`/teacher/lessons/${d.id}/edit`))}
          >
            Провести ещё раз
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="max-w-md text-right text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
