/**
 * How a careful operator fills the questionnaire for a scenario: the buttons of a panel that lead to a classifier leaf,
 * and the rows the caller's answers fill (flags, floors, the gas source). Pure; the workstation's own code
 * (panels.ts resolveDraft, routeDraft) turns the result into tags, flags and plates. The demo lessons fill their 112
 * cards with it (prisma/seed-demo.ts).
 */
import type { IncidentFlags } from "@/lib/incident/types";
import { resolveTree, YES, NO, type TagOption, type TagRow, type TagTree } from "@/lib/routing/tags";
import type { CardAnswers } from "./types";

const has = (o: TagOption, code: number) => (o.types ?? []).includes(code) || (o.smokeTypes ?? []).includes(code);

/** Pick a value for a row that makes `allowed` hold: the first allowed value, any option for «*». */
function pick(tree: TagTree, rowId: string, allowed: string[], answers: CardAnswers, depth: number): boolean {
  if (depth > 6) return false;
  const row = tree.rows.find((r) => r.id === rowId);
  if (!row) return false;
  const chosen = answers[rowId]?.[0];
  if (chosen && (allowed.includes("*") || allowed.includes(chosen))) return true;
  const value = allowed.includes("*") ? row.options?.[0]?.value : allowed[0];
  if (!value) return false;
  answers[rowId] = [value];
  return satisfy(tree, row, answers, depth + 1);
}

/** Choose the rows a row's `showIf` asks for, the rows above them too. */
function satisfy(tree: TagTree, row: TagRow, answers: CardAnswers, depth = 0): boolean {
  for (const [rowId, allowed] of Object.entries(row.showIf ?? {})) {
    if (rowId === "anyOf" || !allowed) continue;
    if (!pick(tree, rowId, allowed as string[], answers, depth)) return false;
  }
  const any = row.showIf?.anyOf;
  if (any?.length && !any.some((id) => answers[id]?.length)) return pick(tree, any[0], ["*"], answers, depth);
  return true;
}

/**
 * The buttons of a panel that lead to the leaf `code`, or null when the panel has no way there. Signs panels follow the
 * option's parent chain («sign1/sign2»); hand-made panels choose the rows its row depends on.
 */
export function answersForLeaf(tree: TagTree, code: number): CardAnswers | null {
  for (const row of tree.rows) {
    for (const o of row.options ?? []) {
      if (!has(o, code)) continue;
      const answers: CardAnswers = { [row.id]: [o.value] };
      if (tree.bySigns && o.parent) {
        if (row.id === "sign2") answers.sign1 = [o.parent];
        if (row.id === "sign3") {
          const up = tree.rows.find((r) => r.id === "sign2")?.options?.find((x) => `${x.parent}/${x.value}` === o.parent);
          if (!up?.parent) continue;
          answers.sign1 = [up.parent];
          answers.sign2 = [up.value];
        }
      } else if (!satisfy(tree, row, answers)) continue;
      // A smoke leaf («задымление: мусоропровод») is the twin of its open-flame button: the button is the way there.
      const r = resolveTree(tree, answers);
      if (r.typeCodes.includes(code) || r.smokeTypeCodes.includes(code)) return answers;
    }
  }
  return null;
}

/** What the caller told that a panel row can hold. */
export type Told = { flags: IncidentFlags; floors?: string; gasSource?: "Магистральный" | "Баллон" };

/**
 * The rows the caller's answers fill, on top of the buttons of the leaf: yes/no rows of the flags, the floors, the gas
 * source. A row the panel does not show for these buttons stays empty — as on the screen.
 */
export function toldAnswers(tree: TagTree, answers: CardAnswers, told: Told): CardAnswers {
  const out: CardAnswers = { ...answers };
  const visible = () => {
    const shown = new Set<string>();
    for (const r of tree.rows) {
      const cond = r.showIf;
      const ok =
        !cond ||
        (Object.entries(cond).every(([id, allowed]) => id === "anyOf" || !allowed || (out[id]?.length && ((allowed as string[]).includes("*") || out[id].some((v) => (allowed as string[]).includes(v))))) &&
          (!cond.anyOf || cond.anyOf.some((id) => out[id]?.length)));
      if (ok) shown.add(r.id);
    }
    return shown;
  };
  for (const row of tree.rows) {
    if (!visible().has(row.id) || out[row.id]?.length) continue;
    if (row.flag && (row.kind === "yesno" || row.kind === "yesnounknown")) {
      const v = told.flags[row.flag];
      if (typeof v === "boolean") out[row.id] = [v ? YES : NO];
    } else if (row.flag && row.kind === "toggle") {
      if (told.flags[row.flag]) out[row.id] = [row.options?.[0]?.value ?? row.label];
    } else if (row.kind === "text" && /этажн/i.test(row.label) && told.floors) {
      out[row.id] = [told.floors];
    } else if (/газ магистральный или баллон/i.test(row.label) && told.gasSource) {
      out[row.id] = [told.gasSource];
    }
  }
  return out;
}
