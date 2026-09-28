/**
 * System settings the administrator edits on the «Настройки» page (norms, journal, backups, integrity check).
 * The access policy has its own fields in src/lib/auth/policy.ts. The labels also name settings in the journal.
 */
export type Field = { key: string; label: string; kind: "number" | "time"; min?: number; max?: number; hint?: string; fallback?: string | number };

export const SETTING_FIELDS: Field[] = [
  { key: "norm.ackSec", label: "ДДС: открыть карточку, с", kind: "number", min: 5, max: 600, hint: "по ответу заказчика 27.09: 30 с от «Добавлена»" },
  { key: "norm.workSec", label: "ДДС: первая запись — статус и текст, с", kind: "number", min: 30, max: 3600, hint: "по ответу заказчика 27.09: 3 мин от «Добавлена»" },
  { key: "norm.typingSec", label: "Таймер набора карточки 112 краснеет после, с", kind: "number", min: 20, max: 600, hint: "как в АРМ-112: 65 с. Сверх норматива баллы за время убывают до нуля; где ноль — в «Весах оценки»" },
  { key: "norm.finishHours", label: "«Не завершено», если нет «Работы завершены» дольше, ч", kind: "number", min: 1, max: 240 },
  { key: "audit.retentionDays", label: "Срок хранения журнала аудита, дн.", kind: "number", min: 183, max: 3650, hint: "не меньше 6 месяцев" },
  { key: "backup.dailyAt", label: "Время ежедневной резервной копии", kind: "time" },
  { key: "backup.keepDays", label: "Сколько дней хранить копии", kind: "number", min: 1, max: 365 },
  { key: "integrity.dailyAt", label: "Время ежедневной проверки целостности", kind: "time", hint: "после резервной копии", fallback: "05:00" },
  { key: "integrity.minFreeGb", label: "Проверка целостности: свободного места на диске не меньше, ГБ", kind: "number", min: 1, max: 1000, fallback: 2 },
];
