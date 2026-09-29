/**
 * Choosing the practice and the control case of a follow-up. Pure: the teacher's form and the server apply the same
 * rules, so the form never offers a pair the server would refuse.
 */
import type { z } from "zod";
import type { skillKeySchema } from "./metadata";

export type Skill = z.infer<typeof skillKeySchema>;
export type Role = "OP112" | "DDS";

/** A 112 call of comparable difficulty: at most this many points from the source call, and practice from control. */
export const NEAR_DIFFICULTY = 2;

export type CaseOption = {
  id: string;
  title: string;
  difficulty: number;
  /** The situation the scenario plays: its ticket without the «-ош» mark and the curated case key. */
  keys: string[];
  /** Group of comparable variants set by the methodologist for this goal; null for an ordinary approved scenario. */
  group: string | null;
  /** Prepared by the methodologist for exactly this purpose (practice or control of the goal). */
  marked: boolean;
  /** The student has already met this situation. A control option never is: it must be new. */
  seen: boolean;
};

export type CasePool = {
  practice: CaseOption[];
  control: CaseOption[];
  /** Why no practice/control pair can be offered, in plain words with what to do; null when there is one. */
  problem: string | null;
};

/** One student of the form: the confirmed error, the place and the cases that suit this student. */
export type Candidate = {
  attemptId: string;
  name: string;
  role: Role;
  service: string | null;
  /** Title of the scenario the error was made on. */
  source: string | null;
  skills: Skill[];
  pool: CasePool;
};

/** Why these two cases cannot be a practice and its control; null when they can. */
export function pairProblem(role: Role, practice: CaseOption, control: CaseOption): string | null {
  if (practice.id === control.id || practice.keys.some((k) => control.keys.includes(k))) return "Контроль должен быть другой ситуацией, чем отработка";
  if (practice.group && control.group && practice.group !== control.group) return "Методист отнёс эти ситуации к разным группам: выберите сопоставимую пару";
  if (role === "OP112" && Math.abs(practice.difficulty - control.difficulty) > NEAR_DIFFICULTY) {
    return `Сложность контроля должна отличаться от отработки не больше чем на ${NEAR_DIFFICULTY}`;
  }
  return null;
}

/** Whether a pool has at least one valid practice/control pair. */
export function hasPair(role: Role, pool: Pick<CasePool, "practice" | "control">): boolean {
  return pool.practice.some((p) => pool.control.some((c) => pairProblem(role, p, c) === null));
}

/** Cases that suit every one of the lists (a group gets one practice and one control); seen by anyone counts as seen. */
export function commonOptions(lists: CaseOption[][]): CaseOption[] {
  if (!lists.length) return [];
  const [first, ...rest] = lists;
  return first.flatMap((option) => {
    const all = rest.map((list) => list.find((o) => o.id === option.id));
    if (all.some((o) => !o)) return [];
    return [{ ...option, seen: option.seen || all.some((o) => o!.seen) }];
  });
}
