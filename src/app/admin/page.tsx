import { aiMode } from "@/lib/ai/provider";
import { db } from "@/lib/db";

export default async function AdminHome() {
  const [users, activeSessions, runningLessons] = await Promise.all([
    db.user.count(),
    db.session.count({ where: { expiresAt: { gt: new Date() } } }),
    db.lesson.count({ where: { status: "RUNNING" } }),
  ]);
  const ai = aiMode();
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Состояние системы</h1>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Пользователей" value={users} />
        <Stat label="Активных сессий" value={activeSessions} />
        <Stat label="Идёт занятий" value={runningLessons} />
      </div>
      <section className="rounded border bg-white p-4 text-sm">
        <h2 className="mb-2 font-semibold">Модели ИИ (настройка в .env)</h2>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
          <dt className="text-arm-desc">Языковая модель</dt>
          <dd>{ai.llm}</dd>
          <dt className="text-arm-desc">Распознавание речи</dt>
          <dd>{ai.stt}</dd>
          <dt className="text-arm-desc">Синтез речи</dt>
          <dd>{ai.tts}</dd>
        </dl>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border bg-white p-4">
      <div className="text-sm text-arm-desc">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
