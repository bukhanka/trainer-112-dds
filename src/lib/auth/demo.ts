/**
 * Public demo stand (DEMO_MODE=true): the published demo accounts must stay usable for every reviewer,
 * so they cannot be blocked, locked out by wrong passwords, or have their password changed.
 */
const DEMO_LOGINS = new Set(["admin", "teacher", "student1", "student2", "student3", "student4", "student5"]);

export function isProtectedDemoLogin(login: string): boolean {
  return process.env.DEMO_MODE === "true" && DEMO_LOGINS.has(login);
}
