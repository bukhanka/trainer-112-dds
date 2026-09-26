/**
 * Tag panels of the 112 card: «что случилось» → panel rows → chosen leaves → final type.
 *
 * Two kinds of panels (data/incident-kinds.json):
 *  - hand-made trees copied from the customer's screenshots (101, 104, «Взрыв»): options
 *    carry classifier leaf codes and the flags they switch on;
 *  - a generic panel for the other groups: classifier signs G → H → I of the group.
 * All functions here are pure and work in the browser as well.
 */
import type { FlagKey, IncidentFlags, TagChoice } from "@/lib/incident/types";
import kindsJson from "../../../data/incident-kinds.json";

export type TagOption = {
  value: string;
  /** classifier leaves this option leads to (open flame for fire panels) */
  types?: number[];
  /** the «задымление» twins of `types` — accepted as equally correct */
  smokeTypes?: number[];
  flag?: FlagKey;
  /** classifier sign value behind the label (signs panels) */
  sign?: string;
  /** option of the row above this one belongs to (signs panels): «sign1» or «sign1/sign2» */
  parent?: string;
  /** the screenshot has this button but the classifier has no leaf for it */
  noLeaf?: boolean;
};

export type TagRowKind = "single" | "multi" | "toggle" | "yesno" | "yesnounknown" | "text";

/** showIf: every listed row must hold one of the values («*» = anything); anyOf: at least one row chosen. */
export type ShowIf = { [rowId: string]: string[] | undefined; anyOf?: string[] };

export type TagRow = {
  id: string;
  label: string;
  kind: TagRowKind;
  flag?: FlagKey;
  showIf?: ShowIf;
  dependsOn?: string;
  options?: TagOption[];
};

export type TagTree = { id: string; title: string; groupId: number; bySigns?: boolean; rows: TagRow[] };

export type IncidentKind = {
  name: string;
  groupId?: number;
  subgroup?: string;
  typeCodes?: number[];
  tree?: string;
  title?: string;
  /** a call that is not an incident: cancel, test call, wrong number… */
  service?: boolean;
  /** «Справка 101» and the like: who the information request is about */
  addressee?: string;
};

export type FlagRow = {
  flag: FlagKey;
  condition: string;
  label: string;
  kind: TagRowKind;
  option?: string;
  placement: "card" | "panel";
};

export type IncidentKindsFile = {
  kinds: IncidentKind[];
  frequent: Record<string, string[]>;
  flagRows: FlagRow[];
  groupFlags: Record<string, FlagKey[]>;
  genericLabels: [string, string, string];
  trees: Record<string, TagTree>;
};

export const INCIDENT_KINDS = kindsJson as unknown as IncidentKindsFile;

/** What the operator clicked: row id → value (single, toggle, yes/no, text) or values (multi). */
export type TagSelection = Record<string, string | string[] | undefined>;

export const YES = "Да";
export const NO = "Нет";
export const NO_DATA = "Нет данных";

function values(selection: TagSelection, rowId: string): string[] {
  const v = selection[rowId];
  if (v === undefined || v === "") return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v];
}

export function kindByName(name: string, file: IncidentKindsFile = INCIDENT_KINDS): IncidentKind | undefined {
  const key = name.trim().toLowerCase().replace(/-/g, " ");
  return file.kinds.find((k) => k.name.toLowerCase().replace(/-/g, " ") === key);
}

export function treeForKind(kind: IncidentKind, file: IncidentKindsFile = INCIDENT_KINDS): TagTree | undefined {
  return kind.tree ? file.trees[kind.tree] : undefined;
}

/** Flag rows that change routing for a classifier group (card buttons first). */
export function flagRowsForGroup(groupId: number, file: IncidentKindsFile = INCIDENT_KINDS): FlagRow[] {
  const flags = new Set(file.groupFlags[String(groupId)] ?? []);
  return file.flagRows.filter((r) => r.placement === "card" || flags.has(r.flag));
}

function rowVisible(row: TagRow, selection: TagSelection): boolean {
  const cond = row.showIf;
  if (!cond) return true;
  for (const [rowId, allowed] of Object.entries(cond)) {
    if (rowId === "anyOf" || !allowed) continue;
    const chosen = values(selection, rowId);
    if (chosen.length === 0) return false;
    if (!allowed.includes("*") && !chosen.some((v) => allowed.includes(v))) return false;
  }
  if (cond.anyOf && !cond.anyOf.some((rowId) => values(selection, rowId).length > 0)) return false;
  return true;
}

/** Rows the operator sees for the current selection (a hidden row keeps no effect). */
export function visibleRows(tree: TagTree, selection: TagSelection): TagRow[] {
  const shown: TagRow[] = [];
  const effective: TagSelection = {};
  for (const row of tree.rows) {
    if (!rowVisible(row, effective)) continue;
    shown.push(row);
    if (selection[row.id] !== undefined) effective[row.id] = selection[row.id];
  }
  return shown;
}

/** Options of a row, narrowed by the choice above for signs panels. */
export function rowOptions(tree: TagTree, row: TagRow, selection: TagSelection): TagOption[] {
  const options = row.options ?? [];
  if (!tree.bySigns || !row.dependsOn) return options;
  const parent = parentKey(tree, row.id, selection);
  return parent ? options.filter((o) => o.parent === parent) : [];
}

function parentKey(tree: TagTree, rowId: string, selection: TagSelection): string | null {
  const s1 = values(selection, "sign1")[0];
  if (rowId === "sign2") return s1 ?? null;
  if (rowId === "sign3") {
    const s2 = values(selection, "sign2")[0];
    return s1 && s2 ? `${s1}/${s2}` : null;
  }
  return null;
}

function chosenOptions(tree: TagTree, row: TagRow, selection: TagSelection): TagOption[] {
  const picked = values(selection, row.id);
  return rowOptions(tree, row, selection).filter((o) => picked.includes(o.value));
}

export type ResolvedTags = {
  /** leaves for the card («Класс.»), in the order the options were picked */
  typeCodes: number[];
  /** smoke twins, accepted by the checker as an equally correct classification */
  smokeTypeCodes: number[];
  flags: IncidentFlags;
  /** chosen buttons for Incident.tags (free-text rows are not tags) */
  tags: TagChoice[];
  /** free-text rows: floors, offense description, description */
  texts: Record<string, string>;
  /** true when at least one leaf is chosen */
  complete: boolean;
};

/** Selection of a hand-made or signs panel → leaves, flags and the tag line of the card. */
export function resolveTree(tree: TagTree, selection: TagSelection): ResolvedTags {
  const rows = visibleRows(tree, selection);
  const flags: IncidentFlags = {};
  const tags: TagChoice[] = [];
  const texts: Record<string, string> = {};
  const typeCodes: number[] = [];
  const smokeTypeCodes: number[] = [];
  let deepest: TagOption[] = [];

  for (const row of rows) {
    const picked = values(selection, row.id);
    if (picked.length === 0) continue;
    if (row.kind === "text") {
      texts[row.id] = picked.join(" ");
      continue;
    }
    for (const value of picked) tags.push({ row: row.label, value });

    if (row.flag) {
      if (row.kind === "toggle") flags[row.flag] = true;
      else if (row.kind === "yesno" || row.kind === "yesnounknown") flags[row.flag] = picked[0] === YES;
    }
    const options = chosenOptions(tree, row, selection);
    for (const option of options) if (option.flag) flags[option.flag] = true;

    if (tree.bySigns) {
      if (row.id.startsWith("sign") && options.some((o) => o.types?.length)) deepest = options;
      continue;
    }
    for (const option of options) {
      for (const code of option.types ?? []) if (!typeCodes.includes(code)) typeCodes.push(code);
      for (const code of option.smokeTypes ?? []) if (!smokeTypeCodes.includes(code)) smokeTypeCodes.push(code);
    }
  }
  if (tree.bySigns) for (const option of deepest) typeCodes.push(...(option.types ?? []));
  return { typeCodes, smokeTypeCodes, flags, tags, texts, complete: typeCodes.length > 0 };
}

// ─── Generic panel: classifier signs of a group ─────────────────────────────

export type LeafType = {
  code: number;
  groupId: number;
  subgroup: string | null;
  sign1: string | null;
  sign2: string | null;
  sign3: string | null;
  finalType: string;
  hiddenFromOperator: boolean;
};

export type SignChoice = [string?, string?, string?];

const same = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim().toLowerCase().replace(/ё/g, "е") === (b ?? "").trim().toLowerCase().replace(/ё/g, "е");

function signOf(t: LeafType, level: number): string | null {
  return level === 0 ? t.sign1 : level === 1 ? t.sign2 : t.sign3;
}

function inScope(t: LeafType, groupId: number, subgroup?: string): boolean {
  return t.groupId === groupId && !t.hiddenFromOperator && (!subgroup || same(t.subgroup, subgroup));
}

/** Leaves of the group whose signs start with the chosen ones. */
export function matchLeaves(leaves: LeafType[], groupId: number, chosen: SignChoice, subgroup?: string): LeafType[] {
  return leaves.filter(
    (t) => inScope(t, groupId, subgroup) && chosen.every((value, level) => !value || same(signOf(t, level), value)),
  );
}

/** Buttons of the next sign row for the chosen prefix. */
export function signOptions(leaves: LeafType[], groupId: number, chosen: SignChoice, subgroup?: string): string[] {
  const level = chosen.filter(Boolean).length;
  if (level > 2) return [];
  const out: string[] = [];
  for (const t of matchLeaves(leaves, groupId, chosen, subgroup)) {
    const value = signOf(t, level)?.trim();
    if (value && !out.some((v) => same(v, value))) out.push(value);
  }
  return out;
}

export type ResolvedLeaf = { leaves: LeafType[]; typeCode: number | null; finalType: string | null };

/**
 * Chosen signs → matching leaves → one leaf when the choice is decisive: a leaf that ends
 * exactly at the chosen depth, the only candidate left, or the «открытое пламя» leaf of a fire.
 */
export function resolveLeaf(leaves: LeafType[], groupId: number, chosen: SignChoice, subgroup?: string): ResolvedLeaf {
  const found = matchLeaves(leaves, groupId, chosen, subgroup);
  const depth = chosen.filter(Boolean).length;
  const exact = found.filter((t) => [0, 1, 2].every((level) => (level < depth ? true : !signOf(t, level))));
  let leaf: LeafType | undefined;
  if (exact.length === 1) leaf = exact[0];
  else if (found.length === 1) leaf = found[0];
  else if (depth === 2) leaf = found.find((t) => same(t.sign3, "открытое пламя"));
  return { leaves: found, typeCode: leaf?.code ?? null, finalType: leaf?.finalType ?? null };
}
