import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { accessPolicy, clampPolicyValue, defaultPolicyValue, DEMO_MIN_SESSION_HOURS, isDemoStand, POLICY_FIELDS, policyBounds, policySettingKey } from "@/lib/auth/policy";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { SETTING_FIELDS as FIELDS } from "@/lib/admin/settings-fields";

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
      if (!raw.trim() || !Number.isFinite(n)) continue; // an emptied field keeps its value
      value = Math.min(f.max ?? n, Math.max(f.min ?? n, Math.round(n)));
    }
    const before = await db.systemSetting.findUnique({ where: { key: f.key } });
    if (before && before.value === value) continue;
    await db.systemSetting.upsert({ where: { key: f.key }, update: { value, updatedById: admin.id }, create: { key: f.key, value, updatedById: admin.id } });
    await audit({ action: "setting.update", actorId: admin.id, actor: admin.login, entity: "SystemSetting", entityId: f.key, before: (before?.value ?? null) as never, after: value });
  }
  revalidatePath("/admin/settings");
}

/** Access policy within safe bounds; every change is journaled with the old and the new value. */
async function savePolicies(form: FormData) {
  "use server";
  const admin = await requireUser(["ADMIN"]);
  const demo = isDemoStand();
  const current = await accessPolicy();
  for (const f of POLICY_FIELDS) {
    const value = clampPolicyValue(f, form.get(f.key), demo);
    if (value == null || value === current[f.key]) continue;
    const key = policySettingKey(f.key);
    await db.systemSetting.upsert({ where: { key }, update: { value, updatedById: admin.id }, create: { key, value, updatedById: admin.id } });
    await audit({ action: "setting.update", actorId: admin.id, actor: admin.login, entity: "SystemSetting", entityId: key, before: current[f.key], after: value });
  }
  revalidatePath("/admin/settings");
  revalidatePath("/admin/users");
}

export default async function SettingsPage() {
  await requireUser(["ADMIN"]);
  const [rows, policy] = await Promise.all([db.systemSetting.findMany(), accessPolicy()]);
  const values = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const demo = isDemoStand();

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
              defaultValue={String(values[f.key] ?? f.fallback ?? "")}
              className="h-9 border border-arm-plate-gray px-2"
            />
          </label>
        ))}
        <button className="h-9 w-40 self-end bg-arm-blue text-white">Сохранить</button>
      </form>
      <form action={savePolicies} className="flex flex-col gap-3 rounded border bg-white p-4 text-sm" aria-labelledby="policy-title">
        <div>
          <h2 id="policy-title" className="font-semibold">
            Политики доступа
          </h2>
          <p className="text-xs text-arm-desc">
            Действуют сразу: блокировка — со следующей неудачной попытки, длина пароля — для новых паролей, срок сессии — для следующих входов (открытые сессии
            доживают свой срок). Пароль всегда содержит буквы и цифры.
          </p>
        </div>
        {POLICY_FIELDS.map((f) => {
          const { min, max } = policyBounds(f, demo);
          const saved = values[policySettingKey(f.key)] !== undefined;
          return (
            <label key={f.key} className="grid gap-1 sm:grid-cols-[1fr_10rem] sm:items-center">
              <span>
                {f.label}, {f.unit}
                <span className="block text-xs text-arm-desc">
                  от {min} до {max} · по умолчанию {defaultPolicyValue(f, process.env, demo)}
                  {f.env ? ` (${f.env} в .env)` : ""}
                  {saved ? "" : " — сейчас действует оно"}
                </span>
              </span>
              <input name={f.key} type="number" min={min} max={max} required defaultValue={policy[f.key]} className="h-9 border border-arm-plate-gray px-2" />
            </label>
          );
        })}
        {demo && (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Демо-стенд: демо-учётки не блокируются перебором пароля, их пароли не меняются, сессия не короче {DEMO_MIN_SESSION_HOURS} ч, а ночной сброс
            возвращает значения по умолчанию — политика не может закрыть вход проверяющим.
          </p>
        )}
        <button className="h-9 w-40 self-end bg-arm-blue text-white">Сохранить</button>
      </form>
      <section className="rounded border bg-white p-4 text-sm">
        <h2 className="mb-2 font-semibold">Задаются при установке (файл .env)</h2>
        <ul className="list-disc pl-5 text-arm-desc">
          <li>Адреса и модели ИИ: языковая модель, распознавание и синтез речи — облачные или локальные. Выключить модели на ходу можно на странице «Состояние».</li>
          <li>База данных и значения по умолчанию для политик доступа (SESSION_HOURS, MAX_FAILED_LOGINS, LOCK_MINUTES).</li>
          <li>Каталог резервных копий (BACKUP_DIR).</li>
        </ul>
      </section>
    </div>
  );
}
