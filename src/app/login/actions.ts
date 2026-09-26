"use server";

import { redirect } from "next/navigation";
import { homeFor, login } from "@/lib/auth/session";

export type LoginState = { error?: string; login?: string };

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const loginName = String(form.get("login") ?? "");
  const password = String(form.get("password") ?? "");
  if (!loginName || !password) return { error: "Введите логин и пароль", login: loginName };

  const result = await login(loginName, password);
  if (!result.ok) return { error: result.error, login: loginName };
  redirect(homeFor(result.user.role));
}
