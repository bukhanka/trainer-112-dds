"use client";

import Link from "next/link";
import { useEffect } from "react";
import { buttonClass } from "@/components/ui";

/** An unexpected failure while showing a page: a plain message, a retry and a way home instead of the default screen. */
export default function PageError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <main className="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-xl font-semibold">Не удалось показать страницу</h1>
      <p className="text-arm-desc">
        Сбой записан в системный журнал{error.digest ? ` (код ${error.digest})` : ""}. Повторите — обычно этого достаточно. Если не помогло, сообщите администратору код и время.
      </p>
      <div className="flex gap-2">
        <button type="button" onClick={() => retry()} className={buttonClass("primary")}>
          Повторить
        </button>
        <Link href="/" className={buttonClass()}>
          На главную
        </Link>
      </div>
    </main>
  );
}
