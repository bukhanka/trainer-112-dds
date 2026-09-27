import bcrypt from "bcryptjs";

const COST = 10;

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/**
 * Password policy: at least `minLength` characters (the access policy, never below 8), letters and digits.
 * Returns a problem in Russian or null. Applies to new passwords only: an account keeps its password when
 * the policy gets stricter, so a policy change never locks anyone out.
 */
export function passwordProblem(plain: string, minLength = 8): string | null {
  const min = Math.max(8, minLength);
  if (plain.length < min) return `Пароль короче ${min} символов`;
  if (!/\p{L}/u.test(plain) || !/\d/.test(plain)) return "Пароль должен содержать буквы и цифры";
  return null;
}
