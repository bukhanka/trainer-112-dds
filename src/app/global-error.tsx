"use client";

/** A failure of the root layout itself: the page renders its own document, without the app's styles. */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="ru">
      <body style={{ fontFamily: "Arial, sans-serif", margin: 0, display: "grid", placeItems: "center", minHeight: "100vh", background: "#f3f4f6", color: "#2f353a" }}>
        <title>Тренажёр 112 / ДДС — сбой</title>
        <main style={{ maxWidth: 520, padding: 32, textAlign: "center" }}>
          <h1 style={{ fontSize: 22 }}>Тренажёр временно недоступен</h1>
          <p>Сбой записан{error.digest ? ` (код ${error.digest})` : ""}. Повторите через минуту; если не помогло — сообщите администратору.</p>
          <button type="button" onClick={() => retry()} style={{ padding: "8px 16px", fontSize: 16 }}>
            Повторить
          </button>
        </main>
      </body>
    </html>
  );
}
