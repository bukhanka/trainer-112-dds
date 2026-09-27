/**
 * Scenario categories and the classifier.
 *
 * A scenario's category is the short word the teacher filters by («пожар», «ДТП», «медицина»). The
 * tickets set it by hand; here every category is tied to groups of the customer's classifier, so that
 * drafts made from text or by category land in the same categories as the tickets, and a category
 * the tickets do not cover («БПЛА», «животные») can still be generated from the classifier.
 */

type TypeRef = { groupId: number; finalType: string; sign1?: string | null };

export type CategoryDef = {
  /** Scenario.category */
  name: string;
  /** Classifier groups (IncidentGroup.id) the category draws its incident types from. */
  groups: number[];
  /** Leaves of other groups that belong here; they are then left out of their own group's category. */
  borrow?: (t: TypeRef) => boolean;
};

/** «Подозрительный предмет, транспорт, боеприпасы, оружие» of «Нарушение правопорядка»: the tickets file them as «угроза взрыва». */
const suspiciousObject = (t: TypeRef) => t.groupId === 15 && /^подозрительный предмет/i.test(t.sign1 ?? "");

/** The ticket categories first, in the order of the tickets, then the rest of the classifier. */
export const CATEGORY_DEFS: CategoryDef[] = [
  { name: "пожар", groups: [1] },
  { name: "ДТП", groups: [2] },
  { name: "медицина", groups: [22] },
  { name: "газ", groups: [13] },
  { name: "правопорядок", groups: [15] },
  { name: "человек в опасности", groups: [17] },
  { name: "ребёнок", groups: [18] },
  { name: "угроза взрыва", groups: [4], borrow: suspiciousObject },
  { name: "обрушение", groups: [5, 6] },
  { name: "смерть", groups: [19] },
  { name: "городское хозяйство", groups: [14] },
  { name: "взрыв", groups: [3] },
  { name: "транспорт", groups: [12] },
  { name: "проблемы на дороге", groups: [16] },
  { name: "природные явления", groups: [7] },
  { name: "экология", groups: [8] },
  { name: "авария на объекте", groups: [9, 10, 11] },
  { name: "животные", groups: [21] },
  { name: "социальная помощь", groups: [20] },
  { name: "БПЛА", groups: [24] },
  { name: "прочее", groups: [23] },
];

export function categoryDef(name: string): CategoryDef | undefined {
  const key = name.trim().toLowerCase().replace(/ё/g, "е");
  return CATEGORY_DEFS.find((c) => c.name.toLowerCase().replace(/ё/g, "е") === key);
}

/** Does a classifier leaf belong to the category? */
export function typeInCategory(def: CategoryDef, t: TypeRef): boolean {
  if (def.borrow?.(t)) return true;
  if (!def.groups.includes(t.groupId)) return false;
  // A leaf another category borrows is not counted twice.
  return !CATEGORY_DEFS.some((other) => other !== def && other.borrow?.(t));
}

/** Category of a classifier leaf: where drafts made from text are filed. */
export function categoryOfType(t: TypeRef | null | undefined): string | null {
  if (!t) return null;
  return CATEGORY_DEFS.find((def) => typeInCategory(def, t))?.name ?? null;
}
