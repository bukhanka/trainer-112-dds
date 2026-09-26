"use client";

import { useActionState } from "react";
import { loginAction, type LoginState } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});

  return (
    <form action={action} className="flex w-full flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm text-arm-dark">
        логин:
        <input
          name="login"
          autoComplete="username"
          defaultValue={state.login}
          autoFocus
          className="h-10 border border-arm-plate-gray bg-white px-3 text-base outline-none focus:border-arm-blue"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm text-arm-dark">
        пароль:
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          className="h-10 border border-arm-plate-gray bg-white px-3 text-base outline-none focus:border-arm-blue"
        />
      </label>
      {state.error && (
        <p role="alert" className="text-sm text-arm-late">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-2 h-11 w-full bg-arm-plate-gray text-base font-semibold tracking-wide text-white hover:bg-arm-desc disabled:opacity-60"
      >
        {pending ? "ВХОД…" : "ВОЙТИ"}
      </button>
    </form>
  );
}
