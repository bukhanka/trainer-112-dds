/**
 * Public demo stand (DEMO_MODE=true): the published demo accounts must stay usable for every reviewer,
 * so they cannot be blocked, locked out by wrong passwords, or have their password changed.
 */
const DEMO_LOGINS = new Set(["admin", "teacher", "student1", "student2", "student3", "student4", "student5"]);

export function isProtectedDemoLogin(login: string): boolean {
  return process.env.DEMO_MODE === "true" && DEMO_LOGINS.has(login);
}

/** The demo group of the stand (prisma/seed.ts): every reviewer starts lessons with it. */
export const DEMO_GROUP_NAME = "Учебная группа № 1";

/** On the demo stand the demo group keeps its name, stays active and keeps the demo students. */
export function isProtectedDemoGroup(name: string): boolean {
  return process.env.DEMO_MODE === "true" && name === DEMO_GROUP_NAME;
}
