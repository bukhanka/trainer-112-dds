"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Section, fieldClass, inputClass } from "@/components/ui";
import type { TeacherSettings } from "@/lib/lessons/form";
import type { FormScenario, LessonFormOptions } from "@/lib/lessons/options";

type Role = "OP112" | "DDS";
type SeatDraft = { included: boolean; role: Role; serviceId: number | null; scenarioIds: string[]; label: string };

export type LessonFormInitial = {
  id: string;
  title: string;
  groupId: string;
  settings: TeacherSettings;
  seats: { studentId: string; role: Role; serviceId: number | null; scenarioIds: string[]; label: string | null }[];
};

const CARD_SOURCES: { value: TeacherSettings["cardSource"]; label: string; hint: string }[] = [
  { value: "generated", label: "Сгенерированные", hint: "Карточки на места ДДС готовит система по заданиям" },
  { value: "students", label: "Сформированные учениками", hint: "Карточки приходят на места ДДС с мест 112" },
  { value: "mixed", label: "Смешанные", hint: "И с мест 112, и сгенерированные" },
];

function defaultTitle() {
  return `Занятие ${new Date().toLocaleDateString("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit" })}`;
}

export function LessonForm({
  options,
  initial,
  defaults,
}: {
  options: LessonFormOptions;
  initial?: LessonFormInitial;
  defaults: TeacherSettings;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? defaultTitle());
  const [groupId, setGroupId] = useState(initial?.groupId ?? options.groups[0]?.id ?? "");
  const [settings, setSettings] = useState<TeacherSettings>(initial?.settings ?? defaults);
  // Tasks that are no longer approved cannot be dealt: they are dropped from the plan with a notice.
  const approvedIds = new Set(options.scenarios.map((x) => x.id));
  const [dropped] = useState(() => [...new Set(initial?.seats.flatMap((x) => x.scenarioIds).filter((x) => !approvedIds.has(x)) ?? [])].length);
  const [seats, setSeats] = useState<Record<string, SeatDraft>>(() => initialSeats(options, initial?.groupId ?? options.groups[0]?.id, initial));
  const [shared, setShared] = useState<string[]>(() => {
    if (!initial?.settings.sameCard) return [];
    return (initial.seats[0]?.scenarioIds ?? []).filter((x) => approvedIds.has(x));
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const group = options.groups.find((g) => g.id === groupId);
  const members = group?.members ?? [];

  // Tasks on offer: approved scenarios of the chosen categories, plus anything already assigned.
  const assigned = new Set([...Object.values(seats).flatMap((s) => s.scenarioIds), ...shared]);
  const tasks: FormScenario[] = options.scenarios.filter(
    (s) => !settings.categories.length || settings.categories.includes(s.category) || assigned.has(s.id),
  );
  const taskNo = new Map(tasks.map((t, i) => [t.id, i + 1]));

  const included = members.filter((m) => seats[m.id]?.included);
  const set = <K extends keyof TeacherSettings>(key: K, value: TeacherSettings[K]) => setSettings((s) => ({ ...s, [key]: value }));
  const patchSeat = (id: string, patch: Partial<SeatDraft>) => setSeats((all) => ({ ...all, [id]: { ...all[id], ...patch } }));

  function changeGroup(id: string) {
    setGroupId(id);
    setSeats(initialSeats(options, id));
  }

  function eachIncluded(fn: (seat: SeatDraft, index: number) => Partial<SeatDraft>) {
    setSeats((all) => {
      const next = { ...all };
      included.forEach((m, i) => {
        next[m.id] = { ...next[m.id], ...fn(next[m.id], i) };
      });
      return next;
    });
  }

  const quick = {
    allDds: () => eachIncluded(() => ({ role: "DDS", serviceId: options.defaultServiceId })),
    all112: () => eachIncluded(() => ({ role: "OP112" })),
    alternate: () => eachIncluded((_, i) => (i % 2 === 0 ? { role: "OP112" } : { role: "DDS", serviceId: options.defaultServiceId })),
    roundRobin: () => eachIncluded((_, i) => ({ scenarioIds: tasks.length ? [tasks[i % tasks.length].id] : [] })),
    everything: () => eachIncluded(() => ({ scenarioIds: tasks.map((t) => t.id) })),
    clear: () => eachIncluded(() => ({ scenarioIds: [] })),
  };

  async function submit() {
    setError(null);
    if (!groupId) return setError("Выберите группу");
    if (!included.length) return setError("Отметьте хотя бы одного ученика");
    setSaving(true);
    const payload = {
      title,
      groupId,
      settings,
      sharedScenarioIds: shared,
      seats: included.map((m, i) => {
        const s = seats[m.id];
        return {
          studentId: m.id,
          role: s.role,
          serviceId: s.role === "DDS" ? s.serviceId : null,
          scenarioIds: s.scenarioIds,
          label: s.label.trim() || `Место ${i + 1}`,
        };
      }),
    };
    try {
      const res = await fetch(initial ? `/api/teacher/lessons/${initial.id}` : "/api/teacher/lessons", {
        method: initial ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setError(data.error ?? "Не удалось сохранить занятие");
        return;
      }
      router.push(`/teacher/lessons/${data.id}`);
      router.refresh();
    } catch {
      setError("Нет связи с сервером. Проверьте сеть и повторите.");
    } finally {
      setSaving(false);
    }
  }

  const noServices = options.services.length === 0;
  // 200+ services: grouped by kind, territorial ДДС first — they are the usual places of a lesson.
  const serviceGroups = Object.entries(
    options.services.reduce<Record<string, typeof options.services>>((acc, svc) => {
      (acc[svc.kind] ??= []).push(svc);
      return acc;
    }, {}),
  ).sort(([a], [b]) => Number(b.startsWith("территориал")) - Number(a.startsWith("территориал")));

  return (
    <div className="flex flex-col gap-4">
      <Section title="Занятие">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Название
            <input className={inputClass} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Группа
            {options.groups.length ? (
              <select className={inputClass} value={groupId} onChange={(e) => changeGroup(e.target.value)}>
                {options.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name} · {g.members.length} уч.
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-sm text-red-700">У вас нет групп. Создайте группу и добавьте учеников в разделе «Группы».</span>
            )}
          </label>
        </div>
      </Section>

      <Section title="Настройки">
        <div className="flex flex-col gap-4">
          <div>
            <div className="mb-1 text-sm">Категории происшествий</div>
            {options.categories.length ? (
              <div className="flex flex-wrap gap-2">
                {options.categories.map((c) => {
                  const on = settings.categories.includes(c);
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={on}
                      onClick={() => set("categories", on ? settings.categories.filter((x) => x !== c) : [...settings.categories, c])}
                      className={`rounded-full border px-3 py-1 text-sm ${on ? "border-arm-blue bg-arm-blue text-white" : "border-arm-gray bg-white hover:border-arm-blue"}`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-sm text-arm-desc">Сценариев пока нет — категории появятся вместе с ними.</p>
            )}
            <p className="mt-1 text-xs text-arm-desc">Ничего не выбрано — все утверждённые сценарии.</p>
          </div>

          <fieldset>
            <legend className="mb-1 text-sm">Источник карточек</legend>
            <div className="grid gap-2 sm:grid-cols-3">
              {CARD_SOURCES.map((o) => (
                <label
                  key={o.value}
                  className={`flex cursor-pointer gap-2 rounded border p-2 text-sm ${settings.cardSource === o.value ? "border-arm-blue bg-arm-blue/5" : "border-arm-gray"}`}
                >
                  <input type="radio" name="cardSource" checked={settings.cardSource === o.value} onChange={() => set("cardSource", o.value)} />
                  <span>
                    <span className="font-medium">{o.label}</span>
                    <span className="block text-xs text-arm-desc">{o.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <NumberField label="Темп: новая карточка раз в, с" value={settings.tempoSec} min={10} max={1800} onChange={(v) => set("tempoSec", v)} />
            <NumberField label="Очередь на месте, карточек" value={settings.maxQueue} min={1} max={10} onChange={(v) => set("maxQueue", v)} />
            <NumberField label="Норматив ответа ДДС, с" value={settings.ackSec} min={5} max={600} onChange={(v) => set("ackSec", v)} />
            <NumberField label="Норматив обработки, с" value={settings.workSec} min={30} max={3600} onChange={(v) => set("workSec", v)} />
            <NumberField label="Набор карточки 112, с" value={settings.typingSec} min={20} max={600} onChange={(v) => set("typingSec", v)} />
          </div>

          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={settings.hints} onChange={(e) => set("hints", e.target.checked)} />
              <span>
                Режим подсказок для начинающих
                <span className="block text-xs text-arm-desc">Пояснения к полям и следующему шагу на рабочем месте</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={settings.brigadeReports} onChange={(e) => set("brigadeReports", e.target.checked)} />
              <span>
                Доклады бригады по телефону
                <span className="block text-xs text-arm-desc">Старший бригады звонит диспетчеру ДДС о ходе работ</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-0.5" checked={settings.adaptive} onChange={(e) => set("adaptive", e.target.checked)} />
              <span>
                Адаптивная сложность
                <span className="block text-xs text-arm-desc">
                  Месту без заданий карточки подбираются по уровню ученика: справляется уверенно — сложнее, ошибается — проще. Задания, отмеченные
                  вручную, и «одна карточка на всех» идут как есть
                </span>
              </span>
            </label>
          </div>
        </div>
      </Section>

      <Section
        title="Места и задания"
        actions={
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={settings.sameCard} onChange={(e) => set("sameCard", e.target.checked)} />
            Одна карточка на всех
          </label>
        }
      >
        {tasks.length ? (
          <ol className="mb-3 grid gap-1 text-sm sm:grid-cols-2">
            {tasks.map((t, i) => (
              <li key={t.id} className="flex items-start gap-2">
                {settings.sameCard ? (
                  <input
                    type="checkbox"
                    className="mt-1"
                    aria-label={`Задание ${i + 1} всем`}
                    checked={shared.includes(t.id)}
                    onChange={(e) => setShared((s) => (e.target.checked ? [...s, t.id] : s.filter((x) => x !== t.id)))}
                  />
                ) : null}
                <span className="inline-flex h-6 min-w-6 items-center justify-center rounded bg-arm-dark px-1 text-xs font-semibold text-white">{i + 1}</span>
                <span>
                  {t.title} <span className="text-xs text-arm-desc">· {t.category} · сложность {t.difficulty}</span>
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mb-3 text-sm text-arm-desc">
            Утверждённых сценариев в выбранных категориях нет. Утвердите их в разделе «Сценарии» или снимите фильтр категорий — без заданий
            карточки возьмутся из выбранных категорий.
          </p>
        )}
        {settings.sameCard && (
          <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-arm-desc">
            <span>Отмеченные задания получат все места — удобно, чтобы сравнить учеников на одной карточке.</span>
            {shared.length > 0 && (
              <Button size="sm" onClick={() => setShared([])}>
                Снять задания
              </Button>
            )}
          </div>
        )}
        {dropped > 0 && (
          <p className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
            {dropped === 1 ? "Одно задание больше не утверждено и снято" : `Заданий больше не утверждено и снято: ${dropped}`} — проверьте раздачу и сохраните.
          </p>
        )}

        {noServices && (
          <p className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
            Справочник служб пуст — место ДДС назначить нельзя. Загрузите справочники (pnpm db:seed).
          </p>
        )}

        <div className="mb-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={quick.allDds} disabled={noServices}>
            Всем ДДС
          </Button>
          <Button size="sm" onClick={quick.all112}>
            Всем 112
          </Button>
          <Button size="sm" onClick={quick.alternate} disabled={noServices}>
            Чередовать 112 / ДДС
          </Button>
          {!settings.sameCard && (
            <>
              <Button size="sm" onClick={quick.roundRobin} disabled={!tasks.length}>
                Задания по кругу
              </Button>
              <Button size="sm" onClick={quick.everything} disabled={!tasks.length}>
                Все задания всем
              </Button>
              <Button size="sm" onClick={quick.clear}>
                Снять задания
              </Button>
            </>
          )}
        </div>

        {members.length ? (
          <ul className="divide-y divide-arm-gray/60 rounded border border-arm-gray/70">
            {members.map((m) => {
              const s = seats[m.id];
              if (!s) return null;
              const place = included.indexOf(m) + 1;
              return (
                <li key={m.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 p-2 ${s.included ? "" : "bg-arm-panel/60 text-arm-desc"}`}>
                  <label className="flex min-w-[14rem] flex-1 items-center gap-2 text-sm">
                    <input type="checkbox" checked={s.included} onChange={(e) => patchSeat(m.id, { included: e.target.checked })} />
                    <span className="font-medium">{m.fullName}</span>
                  </label>
                  {s.included && (
                    <>
                      <input
                        aria-label="Название места"
                        className={`${fieldClass} h-8 w-28`}
                        placeholder={`Место ${place}`}
                        value={s.label}
                        maxLength={40}
                        onChange={(e) => patchSeat(m.id, { label: e.target.value })}
                      />
                      <div className="inline-flex overflow-hidden rounded border border-arm-gray text-sm" role="group" aria-label="Роль">
                        {(["OP112", "DDS"] as const).map((r) => (
                          <button
                            key={r}
                            type="button"
                            aria-pressed={s.role === r}
                            disabled={r === "DDS" && noServices}
                            onClick={() => patchSeat(m.id, { role: r, serviceId: r === "DDS" ? (s.serviceId ?? options.defaultServiceId) : s.serviceId })}
                            className={`h-8 px-3 ${s.role === r ? "bg-arm-dark text-white" : "bg-white hover:bg-arm-panel"} disabled:opacity-40`}
                          >
                            {r === "OP112" ? "112" : "ДДС"}
                          </button>
                        ))}
                      </div>
                      {s.role === "DDS" ? (
                        <select
                          aria-label="Служба ДДС"
                          className={`${fieldClass} h-8 w-full sm:w-56`}
                          value={s.serviceId ?? ""}
                          onChange={(e) => patchSeat(m.id, { serviceId: e.target.value ? Number(e.target.value) : null })}
                        >
                          <option value="">— служба —</option>
                          {serviceGroups.map(([kind, list]) => (
                            <optgroup key={kind} label={kind}>
                              {list.map((svc) => (
                                <option key={svc.id} value={svc.id} title={svc.fullName ?? undefined}>
                                  {svc.shortName}
                                </option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                      ) : (
                        <span className="w-56 text-xs text-arm-desc">Принимает вызовы ИИ-заявителя</span>
                      )}
                      {!settings.sameCard && tasks.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Задания места">
                          {tasks.map((t) => {
                            const on = s.scenarioIds.includes(t.id);
                            return (
                              <button
                                key={t.id}
                                type="button"
                                title={t.title}
                                aria-pressed={on}
                                onClick={() => patchSeat(m.id, { scenarioIds: on ? s.scenarioIds.filter((x) => x !== t.id) : [...s.scenarioIds, t.id] })}
                                className={`h-8 min-w-8 rounded border px-1 text-sm tabular-nums ${on ? "border-arm-blue bg-arm-blue text-white" : "border-arm-gray bg-white hover:border-arm-blue"}`}
                              >
                                {taskNo.get(t.id)}
                              </button>
                            );
                          })}
                          {!s.scenarioIds.length && <span className="text-xs text-arm-desc">из категорий</span>}
                        </div>
                      )}
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-arm-desc">В группе нет учеников — добавьте их в разделе «Группы».</p>
        )}
        <div className="mt-2 text-sm text-arm-desc">
          Мест: {included.length} · 112: {included.filter((m) => seats[m.id].role === "OP112").length} · ДДС:{" "}
          {included.filter((m) => seats[m.id].role === "DDS").length}
        </div>
      </Section>

      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={submit} disabled={saving || !options.groups.length}>
          {saving ? "Сохраняю…" : initial ? "Сохранить изменения" : "Создать занятие"}
        </Button>
        <Button onClick={() => router.back()}>Отмена</Button>
      </div>
      {!initial && <p className="text-xs text-arm-desc">Занятие создаётся черновиком. Старт — на экране занятия.</p>}
    </div>
  );
}

/** Typing «45» must not jump through the minimum: the raw text is kept and clamped when the field is left. */
function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    // The value changed from outside (defaults, another control): show it.
    setShown(value);
    setText(String(value));
  }
  const commit = () => {
    const v = Math.round(Number(text));
    const next = Number.isFinite(v) && text.trim() !== "" ? Math.min(max, Math.max(min, v)) : value;
    setText(String(next));
    setShown(next);
    if (next !== value) onChange(next);
  };
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="min-h-[2.5rem] leading-tight">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        className={inputClass}
        value={text}
        min={min}
        max={max}
        onChange={(e) => {
          setText(e.target.value);
          const v = Math.round(Number(e.target.value));
          // Valid values apply at once, so the form can be saved without leaving the field.
          if (e.target.value.trim() !== "" && Number.isFinite(v) && v >= min && v <= max) {
            setShown(v);
            onChange(v);
          }
        }}
        onBlur={commit}
      />
      <span className="text-xs text-arm-desc">
        от {min} до {max}
      </span>
    </label>
  );
}

function initialSeats(options: LessonFormOptions, groupId: string | undefined, initial?: LessonFormInitial): Record<string, SeatDraft> {
  const group = options.groups.find((g) => g.id === groupId);
  const out: Record<string, SeatDraft> = {};
  const saved = new Map(initial?.seats.map((s) => [s.studentId, s]));
  const approved = new Set(options.scenarios.map((x) => x.id));
  for (const m of group?.members ?? []) {
    const s = saved.get(m.id);
    out[m.id] = s
      ? { included: true, role: s.role, serviceId: s.serviceId, scenarioIds: s.scenarioIds.filter((x) => approved.has(x)), label: s.label ?? "" }
      : {
          included: !initial,
          role: options.services.length ? "DDS" : "OP112",
          serviceId: options.defaultServiceId,
          scenarioIds: [],
          label: "",
        };
  }
  return out;
}
