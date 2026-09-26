import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";

type Field = { key: string; label: string; kind: "number" | "time"; min?: number; max?: number; hint?: string };

const FIELDS: Field[] = [
  { key: "norm.ackSec", label: "Норматив ответа ДДС «Принята / Не принята», с", kind: "number", min: 5, max: 600, hint: "памятка: 30 с" },
  { key: "norm.workSec", label: "Норматив отработки карточки на месте ДДС, с", kind: "number", min: 30, max: 3600, hint: "QA: 3 мин" },
  { key: "norm.typingSec", label: "Таймер набора карточки 112 краснеет после, с", kind: "number", min: 20, max: 600, hint: "по скриншотам ~65 с" },
  { key: "norm.finishHours", label: "«Не завершено», если нет «Работы завершены» дольше, ч", kind: "number", min: 1, max: 240 },
  { key: "audit.retentionDays", label: "Срок хранения журнала аудита, дн.", kind: "number", min: 183, max: 3650, hint: "не меньше 6 месяцев" },
  { key: "backup.dailyAt", label: "Время ежедневной резервной копии", kind: "time" },
  { key: "backup.keepDays", label: "Сколько дней хранить копии", kind: "number", min: 1, max: 365 },
];

async function saveSettings(form: FormData) {
  "use server";
  const admin = await requireUser(["ADMIN"]);
  for (const f of FIELDS) {
    const raw = String(form.get(f.key) ?? "");
    let value: string | number;
    if (f.kind === "time") {
      if (!/^\d{2}:\d{2}$/.test(raw)) continue;
      value = raw;
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n)) continue;
      value = Math.min(f.max ?? n, Math.max(f.min ?? n, Math.round(n)));
    }
    const before = await db.systemSetting.findUnique({ where: { key: f.key } });
    if (before && before.value === value) continue;
    await db.systemSetting.upsert({ where: { key: f.key }, update: { value, updatedById: admin.id }, create: { key: f.key, value, updatedById: admin.id } });
    await audit({ action: "setting.update", actorId: admin.id, actor: admin.login, entity: "SystemSetting", entityId: f.key, before: (before?.value ?? null) as never, after: value });
  }
  revalidatePath("/admin/settings");
}

export default async function SettingsPage() {
  const rows = await db.systemSetting.findMany();
  const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <h1 className="text-xl font-semibold">Настройки</h1>
      <form action={saveSettings} className="flex flex-col gap-3 rounded border bg-white p-4 text-sm">
        {FIELDS.map((f) => (
          <label key={f.key} className="grid gap-1 sm:grid-cols-[1fr_10rem] sm:items-center">
            <span>
              {f.label}
              {f.hint && <span className="block text-xs text-arm-desc">{f.hint}</span>}
            </span>
            <input
              name={f.key}
              type={f.kind}
              min={f.min}
              max={f.max}
              defaultValue={String(values[f.key] ?? "")}
              className="h-9 border border-arm-plate-gray px-2"
            />
          </label>
        ))}
        <button className="h-9 w-40 self-end bg-arm-blue text-white">Сохранить</button>
      </form>
      <section className="rounded border bg-white p-4 text-sm">
        <h2 className="mb-2 font-semibold">Задаются при установке (файл .env)</h2>
        <ul className="list-disc pl-5 text-arm-desc">
          <li>Адреса и модели ИИ: языковая модель, распознавание и синтез речи — облачные или локальные.</li>
          <li>База данных, срок сессии, число попыток входа до блокировки и время блокировки.</li>
          <li>Каталог резервных копий (BACKUP_DIR).</li>
        </ul>
      </section>
    </div>
  );
}
