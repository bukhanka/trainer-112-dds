/**
 * «Что случилось?» and the questionnaire panels of the 112 workstation, on top of the reference
 * data (src/lib/routing/tags.ts): the customer's list of 51 kinds, the hand-made panels for 101,
 * 104 and «Взрыв», and for every other group a panel built from the classifier signs G → H → I
 * plus the flag rows that change routing for that group. Pure: used in the browser and on the server.
 */
import {
  INCIDENT_KINDS,
  flagRowsForGroup,
  kindByName,
  rowOptions,
  treeForKind,
  visibleRows,
  type IncidentKind,
  type LeafType,
  type TagOption,
  type TagRow,
  type TagTree,
} from "@/lib/routing/tags";

export type { IncidentKind, LeafType, TagOption, TagRow, TagTree };
export { rowOptions, visibleRows };

export const KINDS: IncidentKind[] = INCIDENT_KINDS.kinds;

export function findKind(name: string): IncidentKind | undefined {
  return KINDS.find((k) => k.name === name) ?? kindByName(name);
}

/** Chip and panel header: «Происшествие 101», «П: ДТП». */
export function kindTitle(name: string): string {
  const kind = findKind(name);
  if (kind?.title) return kind.title;
  return /^\d{3}$/.test(name) ? `Происшествие ${name}` : `П: ${kind?.name ?? name}`;
}

/** Buttons above the input: the workstation's frequent set. */
export const FREQUENT: string[] = INCIDENT_KINDS.frequent.default;

/** «Значимые типы происшествий» — the list the 112 management approves. */
export const SIGNIFICANT = ["101", "102", "103", "Взрыв"];

// Words people say instead of the official names (the workstation also finds 101 by «пожар»).
const SYNONYMS: Record<string, string[]> = {
  "101": ["пожар", "горит", "возгорание", "дым", "задымление", "пламя", "огонь", "гарь"],
  "102": ["полиция", "драка", "кража", "угон", "грабеж", "нападение", "хулиганство", "шум"],
  "103": ["скорая", "вызов 03", "плохо", "травма", "без сознания", "давление", "отравление", "роды"],
  "104": ["газ", "запах газа", "утечка газа"],
  ДТП: ["авария", "столкновение", "наезд", "сбили"],
  Взрыв: ["взорвалось", "хлопок"],
  "Человек в опасности": ["застрял", "на льдине", "на крыше", "тонет"],
  "Аварии и происшествия в городском хозяйстве": ["прорыв трубы", "нет света", "лифт", "затопление"],
  "Угроза взрыва/террористического акта": ["теракт", "бомба", "заминировано", "подозрительный предмет"],
  "Разбитый градусник": ["ртуть"],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[-,.:;«»"()/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Search like the workstation: every word is a substring of the name or a synonym, any order. */
export function searchKinds(query: string, limit = 60): IncidentKind[] {
  const words = norm(query).split(" ").filter(Boolean);
  if (!words.length) return KINDS.slice(0, limit);
  const scored: { k: IncidentKind; score: number }[] = [];
  for (const k of KINDS) {
    const name = norm(k.name);
    const hay = [name, norm(kindTitle(k.name)), ...(SYNONYMS[k.name] ?? []).map(norm)].join(" | ");
    if (!words.every((w) => hay.includes(w))) continue;
    scored.push({ k, score: (name.startsWith(words[0]) ? 0 : 1) + (words.every((w) => name.includes(w)) ? 0 : 2) });
  }
  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map((s) => s.k);
}

// ─── Panels ──────────────────────────────────────────────────────────────────

const DESCRIPTION_ROW: TagRow = { id: "description", label: "Описание", kind: "text" };

const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase().replace(/ё/g, "е") === (b ?? "").trim().toLowerCase().replace(/ё/g, "е");

/**
 * Panel for a group without a hand-made one: signs G → H → I of the classifier as three rows
 * whose buttons narrow each other, then the flag rows of the group, then «Описание».
 */
export function signsTree(kind: IncidentKind, leaves: LeafType[]): TagTree {
  const groupId = kind.groupId ?? 0;
  const scope = leaves.filter((t) => t.groupId === groupId && !t.hiddenFromOperator && (!kind.subgroup || same(t.subgroup, kind.subgroup)));
  const [l1, l2, l3] = INCIDENT_KINDS.genericLabels;
  const o1: TagOption[] = [];
  const o2: TagOption[] = [];
  const o3: TagOption[] = [];
  const add = (list: TagOption[], value: string, parent: string | undefined, code: number | null) => {
    let o = list.find((x) => same(x.value, value) && x.parent === parent);
    if (!o) {
      o = { value, ...(parent ? { parent } : {}) };
      list.push(o);
    }
    if (code !== null) (o.types ??= []).push(code);
  };
  for (const t of scope) {
    const s1 = t.sign1?.trim();
    const s2 = t.sign2?.trim();
    const s3 = t.sign3?.trim();
    if (!s1) continue;
    add(o1, s1, undefined, s2 ? null : t.code);
    if (!s2) continue;
    add(o2, s2, s1, s3 ? null : t.code);
    if (s3) add(o3, s3, `${s1}/${s2}`, t.code);
  }
  const flagRows: TagRow[] = flagRowsForGroup(groupId)
    .filter((r) => r.placement === "panel")
    .map((r) => ({
      id: `flag_${r.flag}`,
      label: r.label,
      kind: r.kind,
      flag: r.flag,
      showIf: { sign1: ["*"] },
      options: r.kind === "toggle" ? [{ value: r.option ?? r.label }] : undefined,
    }));
  return {
    id: `signs:${kind.name}`,
    title: kindTitle(kind.name),
    groupId,
    bySigns: true,
    rows: [
      { id: "sign1", label: l1, kind: "single", options: o1 },
      { id: "sign2", label: l2, kind: "single", options: o2, showIf: { sign1: ["*"] }, dependsOn: "sign1" },
      { id: "sign3", label: l3, kind: "single", options: o3, showIf: { sign2: ["*"] }, dependsOn: "sign2" },
      ...flagRows,
      DESCRIPTION_ROW,
    ],
  };
}

/** Kinds with a fixed classifier leaf (Консультация…) and service calls get only «Описание». */
function plainTree(kind: IncidentKind): TagTree {
  return { id: `plain:${kind.name}`, title: kindTitle(kind.name), groupId: kind.groupId ?? 0, rows: [DESCRIPTION_ROW] };
}

/** Whether the panel needs classifier leaves (built from signs). */
export function needsLeaves(name: string): boolean {
  const kind = findKind(name);
  return Boolean(kind && !kind.tree && kind.groupId && !kind.typeCodes?.length);
}

/** The panel of a kind; signs panels need the leaves of the kind's group. */
export function panelFor(name: string, leaves?: LeafType[]): TagTree {
  const kind = findKind(name) ?? { name };
  const tree = kind.tree ? treeForKind(kind) : undefined;
  if (tree) return tree;
  if (needsLeaves(name)) return signsTree(kind, leaves ?? []);
  return plainTree(kind);
}

/** Row values as a list; a stored selection may keep a single value as a string. */
export function picked(answers: Record<string, string[] | string | undefined>, rowId: string): string[] {
  const v = answers[rowId];
  if (v === undefined || v === "") return [];
  return (Array.isArray(v) ? v : [v]).filter((x) => x.trim() !== "");
}

/** Buttons of a yes/no row. */
export function choiceOptions(tree: TagTree, row: TagRow, answers: Record<string, string[]>): string[] {
  if (row.kind === "yesno") return ["Да", "Нет"];
  if (row.kind === "yesnounknown") return ["Да", "Нет", "Нет данных"];
  return rowOptions(tree, row, answers).map((o) => o.value);
}

/** Drop answers of rows that are hidden now (the branch changed) or whose button disappeared. */
export function pruneAnswers(tree: TagTree, answers: Record<string, string[]>): Record<string, string[]> {
  let current = answers;
  for (let i = 0; i < 5; i++) {
    const next: Record<string, string[]> = {};
    for (const row of visibleRows(tree, current)) {
      const v = picked(current, row.id);
      if (!v.length) continue;
      if (row.kind === "text") next[row.id] = v;
      else {
        const allowed = choiceOptions(tree, row, current);
        const kept = v.filter((x) => allowed.includes(x));
        if (kept.length) next[row.id] = kept;
      }
    }
    if (JSON.stringify(next) === JSON.stringify(current)) return next;
    current = next;
  }
  return current;
}
