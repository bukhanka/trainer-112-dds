import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { groupScope } from "@/lib/teacher/access";

export const DEFAULT_DDS_SERVICE = "Поселение Вороновское";

export type FormGroup = { id: string; name: string; members: { id: string; fullName: string }[] };
export type FormService = { id: number; shortName: string; fullName: string | null; kind: string };
export type FormScenario = { id: string; title: string; category: string; difficulty: number };

export type LessonFormOptions = {
  groups: FormGroup[];
  services: FormService[];
  scenarios: FormScenario[];
  categories: string[];
  defaultServiceId: number | null;
};

/** Everything the lesson form offers: own groups, the service list, approved tasks. */
export async function loadLessonFormOptions(user: SessionUser): Promise<LessonFormOptions> {
  const [groups, services, scenarios, categoryRows] = await Promise.all([
    db.group.findMany({
      where: { ...groupScope(user), archivedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        members: { select: { user: { select: { id: true, fullName: true, role: true, isBlocked: true } } } },
      },
    }),
    db.service.findMany({ orderBy: { orderIdx: "asc" }, select: { id: true, shortName: true, fullName: true, kind: true } }),
    db.scenario.findMany({
      where: { status: "APPROVED" },
      orderBy: [{ category: "asc" }, { difficulty: "asc" }, { title: "asc" }],
      select: { id: true, title: true, category: true, difficulty: true },
    }),
    db.scenario.findMany({ where: { status: { not: "ARCHIVED" } }, distinct: ["category"], select: { category: true } }),
  ]);

  const defaultService =
    services.find((s) => s.shortName === DEFAULT_DDS_SERVICE) ??
    services.find((s) => s.kind.startsWith("территориал")) ??
    services[0];

  return {
    groups: groups.map((g) => ({
      id: g.id,
      name: g.name,
      members: g.members
        .map((m) => m.user)
        .filter((u) => u.role === "STUDENT" && !u.isBlocked)
        .map((u) => ({ id: u.id, fullName: u.fullName }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName, "ru")),
    })),
    services,
    scenarios,
    categories: categoryRows.map((c) => c.category).sort((a, b) => a.localeCompare(b, "ru")),
    defaultServiceId: defaultService?.id ?? null,
  };
}
