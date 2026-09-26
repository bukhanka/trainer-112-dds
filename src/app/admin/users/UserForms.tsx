"use client";

import { useActionState, useState, useTransition } from "react";
import { createUser, resetPassword, setBlocked, type ActionState } from "./actions";

const input = "h-9 border border-arm-plate-gray bg-white px-2 text-sm outline-none focus:border-arm-blue";

export function CreateUserForm() {
  const [state, action, pending] = useActionState<ActionState, FormData>(createUser, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-2 rounded border bg-white p-3">
      <label className="flex flex-col text-xs text-arm-desc">
        Логин
        <input name="login" required className={input} />
      </label>
      <label className="flex flex-col text-xs text-arm-desc">
        ФИО
        <input name="fullName" required className={`${input} w-64`} />
      </label>
      <label className="flex flex-col text-xs text-arm-desc">
        Роль
        <select name="role" className={input} defaultValue="STUDENT">
          <option value="STUDENT">Обучающийся</option>
          <option value="TEACHER">Преподаватель</option>
          <option value="ADMIN">Администратор</option>
        </select>
      </label>
      <label className="flex flex-col text-xs text-arm-desc">
        Пароль
        <input name="password" type="password" required className={input} />
      </label>
      <button disabled={pending} className="h-9 bg-arm-blue px-4 text-sm text-white disabled:opacity-60">
        Создать
      </button>
      <Message state={state} />
    </form>
  );
}

export function UserRowActions({ userId, blocked }: { userId: string; blocked: boolean }) {
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const [password, setPassword] = useState("");

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        disabled={pending}
        onClick={() => start(async () => setState(await setBlocked(userId, !blocked)))}
        className="rounded border px-2 py-0.5 text-xs hover:bg-arm-panel"
      >
        {blocked ? "Разблокировать" : "Заблокировать"}
      </button>
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        type="password"
        placeholder="новый пароль"
        className="h-7 w-32 border border-arm-plate-gray px-1 text-xs"
      />
      <button
        disabled={pending || !password}
        onClick={() =>
          start(async () => {
            setState(await resetPassword(userId, password));
            setPassword("");
          })
        }
        className="rounded border px-2 py-0.5 text-xs hover:bg-arm-panel disabled:opacity-50"
      >
        Сменить пароль
      </button>
      <Message state={state} />
    </div>
  );
}

function Message({ state }: { state: ActionState }) {
  if (state.error) return <span className="text-xs text-arm-late">{state.error}</span>;
  if (state.ok) return <span className="text-xs text-green-700">{state.ok}</span>;
  return null;
}
