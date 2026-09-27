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

// Words people say instead of the official names (the workstation also finds 101 by «пожар»). The whole
// classifier is searched as well, on the server (searchKindsByLeaves): «судороги» finds 103 through its leaf.
const SYNONYMS: Record<string, string[]> = {
  "101": ["пожар", "горит", "возгорание", "дым", "задымление", "пламя", "огонь", "гарь", "мусоропровод", "тлеет", "пожарная сигнализация"],
  "102": ["полиция", "драка", "кража", "угон", "грабеж", "нападение", "хулиганство", "шум", "избили", "ограбление", "мошенники", "нож", "оружие", "стрельба"],
  "103": [
    "скорая",
    "вызов 03",
    "медицина",
    "медицинская помощь",
    "плохо",
    "травма",
    "без сознания",
    "обморок",
    "давление",
    "отравление",
    "роды",
    "судороги",
    "приступ",
    "эпилепсия",
    "инсульт",
    "инфаркт",
    "сердце",
    "задыхается",
    "кровотечение",
    "температура",
    "аллергия",
    "ожог",
    "перелом",
  ],
  "104": ["газ", "запах газа", "утечка газа", "газовый баллон"],
  ДТП: ["авария", "столкновение", "наезд", "сбили", "пешеход"],
  Взрыв: ["взорвалось", "хлопок"],
  "Человек в опасности": ["застрял", "на льдине", "на крыше", "тонет", "не открывает дверь", "суицид"],
  "Ребенок в опасности": ["ребенок", "потерялся"],
  "Смертельный исход": ["умер", "скончался", "смерть", "труп"],
  "Аварии и происшествия в городском хозяйстве": ["прорыв трубы", "нет света", "лифт", "затопление", "течь", "залив"],
  "Угроза взрыва/террористического акта": ["теракт", "бомба", "заминировано", "подозрительный предмет"],
  "Угроза обрушения": ["трещина", "крепление", "табло"],
  "Разбитый градусник": ["ртуть"],
};

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/[-,.:;«»"()/]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The words of a search as the workstation takes them: any order, and a word ending may differ («судорогами»,
 * «медицина» → «медицинской»): a long word is matched by its stem — nine letters and more without the last three,
 * eight without two, six or seven without one («приступ» still does not match «пристроить»).
 */
export function searchWords(query: string): string[] {
  return norm(query)
    .split(" ")
    .filter(Boolean)
    .map((w) => w.slice(0, w.length - (w.length >= 9 ? 3 : w.length === 8 ? 2 : w.length >= 6 ? 1 : 0)));
}

/** Search like the workstation: every word is a substring of the name or a synonym, any order. */
export function searchKinds(query: string, limit = 60): IncidentKind[] {
  const words = searchWords(query);
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

/** The kind a classifier leaf is chosen under: the kind of its group, or of its subgroup when there is one. */
export function kindOfLeaf(leaf: Pick<LeafType, "groupId" | "subgroup">): IncidentKind | undefined {
  const same = KINDS.filter((k) => k.groupId === leaf.groupId);
  return same.find((k) => k.subgroup && norm(k.subgroup) === norm(leaf.subgroup ?? "")) ?? same.find((k) => !k.subgroup) ?? same[0];
}

export type LeafHit = { name: string; match: string };

/**
 * Search through the whole classifier: a leaf (its type and signs) or its group name holding every word leads to
 * the kind the leaf is chosen under — «судороги» → 103 («Судороги»), «мусоропровод» → 101. The hint is the most
 * specific text that matched (the type, a sign, the group). Kinds are ranked by that and by how many of their
 * leaves matched: «медицинской» is first of all 103, though a lift with «требуется медицинская помощь» matches too.
 */
export function searchKindsByLeaves(query: string, leaves: LeafType[], groups: { id: number; name: string }[], limit = 8): LeafHit[] {
  const words = searchWords(query);
  if (!words.length) return [];
  const groupName = new Map(groups.map((g) => [g.id, g.name]));
  const holds = (text: string | null | undefined) => Boolean(text) && words.every((w) => norm(text!).includes(w));
  const hits = new Map<string, { match: string; score: number; count: number }>();
  for (const leaf of leaves) {
    if (leaf.hiddenFromOperator) continue;
    const texts: [string | null | undefined, number][] = [
      [leaf.finalType, 3],
      [leaf.sign3, 2],
      [leaf.sign2, 2],
      [leaf.sign1, 2],
      [leaf.subgroup, 2],
      [groupName.get(leaf.groupId), 1],
    ];
    const found = texts.find(([t]) => holds(t));
    if (!found) continue;
    const kind = kindOfLeaf(leaf);
    if (!kind) continue;
    const score = found[1] + (norm(leaf.finalType).startsWith(words[0]) ? 1 : 0);
    const h = hits.get(kind.name) ?? { match: "", score: -1, count: 0 };
    h.count++;
    if (score > h.score) Object.assign(h, { score, match: found[0]! });
    hits.set(kind.name, h);
  }
  return [...hits.entries()]
    .sort((a, b) => b[1].score - a[1].score || b[1].count - a[1].count)
    .slice(0, limit)
    .map(([name, h]) => ({ name, match: h.match }));
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
