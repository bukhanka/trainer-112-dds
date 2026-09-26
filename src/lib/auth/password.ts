import bcrypt from "bcryptjs";

const COST = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Password policy: at least 8 characters, letters and digits. Returns a problem in Russian or null. */
export function passwordProblem(plain: string): string | null {
  if (plain.length < 8) return "Пароль короче 8 символов";
  if (!/\p{L}/u.test(plain) || !/\d/.test(plain)) return "Пароль должен содержать буквы и цифры";
  return null;
}
