"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";

/** «Удалить» with a confirmation; the server checks that the viewer uploaded it or is an administrator. */
export function DeleteMaterial({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    if (!window.confirm(`Удалить материал «${title}»? Ученики и преподаватели больше не смогут его открыть.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/materials/${id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(data.error ?? "Не удалось удалить");
      else router.refresh();
    } catch {
      setError("Нет связи с сервером");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size="sm" variant="ghost" disabled={busy} onClick={remove} className="text-red-700 hover:bg-red-50">
        {busy ? "Удаляю…" : "Удалить"}
      </Button>
      {error && (
        <span role="alert" className="basis-full text-right text-xs text-red-700">
          {error}
        </span>
      )}
    </>
  );
}
