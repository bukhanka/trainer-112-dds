import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { presentSections } from "./sections";

export type ScenarioFilters = { status?: string | null; category?: string | null; q?: string | null };

export function scenarioWhere(f: ScenarioFilters): Prisma.ScenarioWhereInput {
  const where: Prisma.ScenarioWhereInput = {};
  if (f.status === "DRAFT" || f.status === "APPROVED" || f.status === "ARCHIVED") where.status = f.status;
  else where.status = { not: "ARCHIVED" };
  if (f.category) where.category = f.category;
  if (f.q?.trim()) where.OR = [{ title: { contains: f.q.trim(), mode: "insensitive" } }, { ticketRef: { contains: f.q.trim(), mode: "insensitive" } }];
  return where;
}

/** The scenario library is shared by all teachers of the centre. */
export async function listScenarios(f: ScenarioFilters) {
  const rows = await db.scenario.findMany({
    where: scenarioWhere(f),
    orderBy: [{ status: "asc" }, { category: "asc" }, { title: "asc" }],
    select: {
      id: true,
      title: true,
      category: true,
      difficulty: true,
      status: true,
      source: true,
      ticketRef: true,
      approvedSections: true,
      updatedAt: true,
      caller: true,
      truth: true,
      ddsCard: true,
      ddsReference: true,
    },
  });
  return rows.map(({ caller, truth, ddsCard, ddsReference, ...r }) => {
    const present = presentSections({ caller, truth, ddsCard, ddsReference });
    return { ...r, present: present.length, approved: present.filter((k) => r.approvedSections.includes(k)).length };
  });
}
