"use client";

import { useActionState } from "react";
import { buttonClass, fieldClass } from "@/components/ui";
import { createFromText, type NewScenarioState } from "./actions";

const EXAMPLES = [
  "Горит квартира на 5 этаже, в квартире остался ребёнок. Звонит соседка снизу Петрова Анна Ивановна, ул. Грина, 11. Дом газифицирован.",
  "На перекрёстке Тюменской улицы и Тюменского проезда столкнулись две машины, один водитель без сознания, течёт бензин.",
  "В подъезде сильно пахнет газом, пожилой мужчина звонит с третьего этажа, ул. Вавилова, 81.",
];

export function NewScenarioForm() {
  const [state, action, pending] = useActionState<NewScenarioState, FormData>(createFromText, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Что случилось — своими словами
        <textarea
          name="text"
          required
          rows={6}
          defaultValue={state.text}
          placeholder="Где, что произошло, кто звонит, есть ли пострадавшие, что заявитель скажет только на вопрос…"
          className={`${fieldClass} w-full p-2`}
        />
      </label>
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="text-arm-desc">Примеры:</span>
        {EXAMPLES.map((e, i) => (
          <button
            key={i}
            type="button"
            onClick={(ev) => {
              const area = (ev.currentTarget.form?.elements.namedItem("text") as HTMLTextAreaElement | null) ?? null;
              if (area) area.value = e;
            }}
            className="rounded border border-arm-gray px-2 py-0.5 hover:border-arm-blue"
          >
            {e.slice(0, 38)}…
          </button>
        ))}
      </div>
      <label className="flex items-center gap-3 text-sm">
        Сложность
        <select name="difficulty" defaultValue="" className={`${fieldClass} h-9`}>
          <option value="">предложит система</option>
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      {state.error && <p className="text-sm text-arm-late">{state.error}</p>}
      <button disabled={pending} className={`${buttonClass("primary")} self-start`}>
        {pending ? "Собираю черновик…" : "Создать черновик сценария"}
      </button>
    </form>
  );
}
