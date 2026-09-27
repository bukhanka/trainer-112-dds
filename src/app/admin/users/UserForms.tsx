"use client";

import { startTransition, useActionState, useState, useTransition } from "react";
import { createUser, resetPassword, setBlocked, type ActionState } from "./actions";

const input = "h-9 border border-arm-plate-gray bg-white px-2 text-sm outline-none focus:border-arm-blue";

export type GroupChoice = { id: string; name: string; teacher: string | null };

export function CreateUserForm({ groups = [], minPasswordLength = 8 }: { groups?: GroupChoice[]; minPasswordLength?: number }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(createUser, {});
  // Submitted without React's automatic form reset: a refused form keeps what was typed. A created user gives a
  // new key — the fields start empty for the next one.
  return <CreateUserFields key={state.ok ?? "new"} groups={groups} minPasswordLength={minPasswordLength} state={state} pending={pending} submit={action} />;
}

function CreateUserFields({
  groups,
  minPasswordLength,
  state,
  pending,
  submit,
}: {
  groups: GroupChoice[];
  minPasswordLength: number;
  state: ActionState;
  pending: boolean;
  submit: (form: FormData) => void;
}) {
  const [role, setRole] = useState("STUDENT");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        startTransition(() => submit(form));
      }}
      className="flex flex-wrap items-end gap-2 rounded border bg-white p-3"
    >
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
        <select name="role" className={input} value={role} onChange={(e) => setRole(e.target.value)}>
          <option value="STUDENT">Обучающийся</option>
          <option value="TEACHER">Преподаватель</option>
          <option value="ADMIN">Администратор</option>
        </select>
      </label>
      {role === "STUDENT" && (
        <label className="flex flex-col text-xs text-arm-desc">
          Добавить в группу
          <select name="groupId" className={`${input} w-64`} defaultValue="">
            <option value="">— без группы —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
                {g.teacher ? ` · ${g.teacher}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
      <label className="flex flex-col text-xs text-arm-desc">
        Пароль · от {minPasswordLength} символов, буквы и цифры
        <input name="password" type="password" required minLength={minPasswordLength} className={input} />
      </label>
      <button disabled={pending} className="h-9 bg-arm-blue px-4 text-sm text-white disabled:opacity-60">
        Создать
      </button>
      <Message state={state} />
    </form>
  );
}

/**
 * Block and password buttons of a user row. Nobody is offered to block their own account, blocking asks first,
 * and changing one's own password warns that it ends one's own sessions. A demo account of the public stand gets
 * no buttons: the server refuses to change it anyway.
 */
export function UserRowActions({ userId, login, blocked, self, demo }: { userId: string; login: string; blocked: boolean; self: boolean; demo: boolean }) {
  const [state, setState] = useState<ActionState>({});
  const [pending, start] = useTransition();
  const [password, setPassword] = useState("");

  if (demo) return <span className="text-xs text-arm-desc">демо-учётка стенда: не блокируется, пароль не меняется</span>;

  function toggleBlock() {
    if (!blocked && !window.confirm(`Заблокировать ${login}? Пользователь сразу выйдет из системы и не сможет войти, пока его не разблокируют.`)) return;
    start(async () => setState(await setBlocked(userId, !blocked)));
  }

  function changePassword() {
    if (self && !window.confirm("Сменить свой пароль? Все ваши сессии завершатся — войдите снова с новым паролем.")) return;
    start(async () => {
      setState(await resetPassword(userId, password));
      setPassword("");
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {self ? (
        <span className="text-xs text-arm-desc" title="Свою учётную запись заблокировать нельзя">
          это вы
        </span>
      ) : (
        <button disabled={pending} onClick={toggleBlock} className="rounded border px-2 py-0.5 text-xs hover:bg-arm-panel disabled:opacity-50">
          {blocked ? "Разблокировать" : "Заблокировать"}
        </button>
      )}
      <input
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        type="password"
        placeholder="новый пароль"
        className="h-7 w-32 border border-arm-plate-gray px-1 text-xs"
      />
      <button disabled={pending || !password} onClick={changePassword} className="rounded border px-2 py-0.5 text-xs hover:bg-arm-panel disabled:opacity-50">
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
