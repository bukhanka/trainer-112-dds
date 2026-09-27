import { after } from "next/server";

/**
 * Model work that must not hold the user's request: the reviews of ДДС comments run after the response is
 * sent, a few at a time, so the end of a lesson with a hundred plates does not fire a hundred calls at once.
 * Outside a request (scripts, tests) the task simply runs detached. Never throws.
 */
const MAX_PARALLEL = Math.max(1, Number(process.env.AI_BACKGROUND_PARALLEL ?? 2));
let running = 0;
const waiting: (() => void)[] = [];

async function inSlot<T>(task: () => Promise<T>): Promise<T> {
  if (running < MAX_PARALLEL) running++;
  else await new Promise<void>((resolve) => waiting.push(resolve)); // the finished task hands its slot over
  try {
    return await task();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else running--;
  }
}

export function inBackground(label: string, task: () => Promise<void>): void {
  const run = () => inSlot(task).catch((err) => console.error(`background ${label} failed`, err));
  try {
    after(run);
  } catch {
    void run();
  }
}
