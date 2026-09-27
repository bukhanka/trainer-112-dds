import type { SessionUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { groupLocations, type LocationGroup } from "@/lib/scenarios/location";
import { scenarioPlace } from "@/lib/scenarios/place";
import { groupScope } from "@/lib/teacher/access";
import type { CoverageScenario } from "./coverage";

export const DEFAULT_DDS_SERVICE = "Поселение Вороновское";

export type FormGroup = { id: string; name: string; members: { id: string; fullName: string }[] };
export type FormService = { id: number; shortName: string; fullName: string | null; kind: string };
export type FormScenario = {
  id: string;
  title: string;
  category: string;
  difficulty: number;
  okrug: string | null;
  district: string | null;
  /** no ДДС card (a silent line, a repeat call): a task for the 112 place only */
  only112?: boolean;
};

export type LessonFormOptions = {
  groups: FormGroup[];
  services: FormService[];
  scenarios: FormScenario[];
  categories: string[];
  defaultServiceId: number | null;
  /** What places without tasks can draw, for the counts and warnings of the form (lessons/coverage.ts). */
  coverage: CoverageScenario[];
  /** Okrugs and districts of approved scenarios, for the location of the lesson. */
  locations: LocationGroup[];
};

/**
 * Scenarios a lesson may deal, with their location: approved ones, and drafts with an approved caller (they play
 * at 112 places only). An approved scenario without a ДДС card (a silent line, a call that breaks off) is for the
 * 112 place only too.
 */
export async function dealableScenarios(): Promise<CoverageScenario[]> {
  const rows = await db.scenario.findMany({
    where: { OR: [{ status: "APPROVED" }, { status: "DRAFT", approvedSections: { has: "caller" } }] },
    select: { id: true, category: true, status: true, truth: true, ddsCard: true },
  });
  return rows.map((s) => {
    const place = scenarioPlace(s.truth);
    return { id: s.id, category: s.category, okrug: place.okrug, district: place.district, approved: s.status === "APPROVED" && s.ddsCard !== null };
  });
}

/** Everything the lesson form offers: own groups, the service list, approved tasks. */
export async function loadLessonFormOptions(user: SessionUser): Promise<LessonFormOptions> {
  const [groups, services, scenarios, categoryRows, coverage] = await Promise.all([
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
      select: { id: true, title: true, category: true, difficulty: true, ddsCard: true },
    }),
    db.scenario.findMany({ where: { status: { not: "ARCHIVED" } }, distinct: ["category"], select: { category: true } }),
    dealableScenarios(),
  ]);
  const placeOf = new Map(coverage.map((c) => [c.id, c]));

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
    scenarios: scenarios.map(({ ddsCard, ...s }) => ({
      ...s,
      okrug: placeOf.get(s.id)?.okrug ?? null,
      district: placeOf.get(s.id)?.district ?? null,
      ...(ddsCard === null ? { only112: true } : {}),
    })),
    categories: categoryRows.map((c) => c.category).sort((a, b) => a.localeCompare(b, "ru")),
    defaultServiceId: defaultService?.id ?? null,
    coverage,
    locations: groupLocations(coverage.filter((c) => c.approved)),
  };
}
