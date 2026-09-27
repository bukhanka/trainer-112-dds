/**
 * Usage statistics for the administrator, per Moscow day: logins and active people (from the journal),
 * lessons and self-practice, attempts and teacher confirmations, model calls and answers by the rules
 * (src/lib/admin/usage.ts). Plain aggregate queries over indexed dates — cheap enough to run on every view.
 */
import { db } from "../db";
import { lastDays, moscowDayStart } from "./days";
import { readUsage } from "./usage";

export type DayStats = {
  day: string;
  logins: number;
  activeUsers: number;
  lessonsStarted: number;
  lessonsFinished: number;
  practices: number;
  attempts: number;
  confirmed: number;
  aiCalls: number;
  aiRules: number;
  aiFailed: number;
};

export type UsageStats = {
  days: DayStats[];
  totals: Omit<DayStats, "day" | "activeUsers">;
  /** Different people over the whole period (not the sum of the days). */
  activeUsers: number;
  /** First day with any model counter: before it the counters did not exist yet. */
  countersSince: string | null;
  inSystem: { users: number; students: number; teachers: number; groups: number; lessons: number; attempts: number; scenarios: number };
};

const METRICS = ["logins", "activeUsers", "lessonsStarted", "lessonsFinished", "practices", "attempts", "confirmed", "aiCalls", "aiRules", "aiFailed"] as const;
type Metric = (typeof METRICS)[number];
export type DayRow = { day: string; n: number };

/** Puts query rows onto the calendar: every day present, missing ones are zero. */
export function fillDays(days: string[], series: Partial<Record<Metric, DayRow[]>>): DayStats[] {
  return days.map((day) => {
    const out = { day } as DayStats;
    for (const m of METRICS) out[m] = Number(series[m]?.find((r) => r.day === day)?.n ?? 0);
    return out;
  });
}

export function sumDays(days: DayStats[]): UsageStats["totals"] {
  const totals = {} as UsageStats["totals"];
  for (const m of METRICS) if (m !== "activeUsers") totals[m] = days.reduce((s, d) => s + d[m], 0);
  return totals;
}

// A Prisma DateTime column holds UTC without a zone; the day is taken on the Moscow clock.
const FAILED_LOGINS = ["auth.login.fail", "auth.login.blocked", "auth.login.locked", "auth.lockout"];

export async function usageStats(count = 14, now = new Date()): Promise<UsageStats> {
  const days = lastDays(count, now);
  const since = moscowDayStart(days[0]);

  const [logins, active, activeTotal, started, finished, attempts, confirmed, usage, firstCounter, inSystem] = await Promise.all([
    db.$queryRaw<DayRow[]>`
      SELECT to_char(("at" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM "AuditLog" WHERE "action" = 'auth.login.ok' AND "at" >= ${since} GROUP BY 1`,
    db.$queryRaw<DayRow[]>`
      SELECT day, count(DISTINCT uid)::int AS n FROM (
        SELECT to_char(("at" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') AS day, "actorId" AS uid
        FROM "AuditLog" WHERE "actorId" IS NOT NULL AND "at" >= ${since} AND NOT ("action" = ANY(${FAILED_LOGINS}))
        UNION ALL
        SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD'), "studentId"
        FROM "Attempt" WHERE "createdAt" >= ${since}
      ) t GROUP BY day`,
    db.$queryRaw<{ n: number }[]>`
      SELECT count(DISTINCT uid)::int AS n FROM (
        SELECT "actorId" AS uid FROM "AuditLog" WHERE "actorId" IS NOT NULL AND "at" >= ${since} AND NOT ("action" = ANY(${FAILED_LOGINS}))
        UNION ALL
        SELECT "studentId" FROM "Attempt" WHERE "createdAt" >= ${since}
      ) t`,
    db.$queryRaw<{ day: string; lessons: number; practices: number }[]>`
      SELECT to_char(("startedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') AS day,
        count(*) FILTER (WHERE coalesce("settings"->>'practice', 'false') <> 'true')::int AS lessons,
        count(*) FILTER (WHERE coalesce("settings"->>'practice', 'false') = 'true')::int AS practices
      FROM "Lesson" WHERE "startedAt" >= ${since} GROUP BY 1`,
    db.$queryRaw<DayRow[]>`
      SELECT to_char(("finishedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM "Lesson" WHERE "finishedAt" >= ${since} AND coalesce("settings"->>'practice', 'false') <> 'true' GROUP BY 1`,
    db.$queryRaw<DayRow[]>`
      SELECT to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM "Attempt" WHERE "createdAt" >= ${since} GROUP BY 1`,
    db.$queryRaw<DayRow[]>`
      SELECT to_char(("reviewedAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Moscow', 'YYYY-MM-DD') AS day, count(*)::int AS n
      FROM "Attempt" WHERE "reviewedAt" >= ${since} AND "reviewStatus" <> 'PENDING' GROUP BY 1`,
    readUsage(days),
    db.usageCounter.findFirst({ orderBy: { day: "asc" }, select: { day: true } }),
    systemCounts(),
  ]);

  const counter = (name: "ai.chat" | "ai.voice" | "ai.rules" | "ai.failed") => days.map((day) => ({ day, n: usage[day]?.[name] ?? 0 }));
  const filled = fillDays(days, {
    logins,
    activeUsers: active,
    lessonsStarted: started.map((r) => ({ day: r.day, n: r.lessons })),
    practices: started.map((r) => ({ day: r.day, n: r.practices })),
    lessonsFinished: finished,
    attempts,
    confirmed,
    aiCalls: days.map((day) => ({ day, n: (usage[day]?.["ai.chat"] ?? 0) + (usage[day]?.["ai.voice"] ?? 0) })),
    aiRules: counter("ai.rules"),
    aiFailed: counter("ai.failed"),
  });
  return { days: filled, totals: sumDays(filled), activeUsers: activeTotal[0]?.n ?? 0, countersSince: firstCounter?.day ?? null, inSystem };
}

async function systemCounts(): Promise<UsageStats["inSystem"]> {
  const [users, students, teachers, groups, lessons, attempts, scenarios] = await Promise.all([
    db.user.count({ where: { isBlocked: false } }),
    db.user.count({ where: { isBlocked: false, role: "STUDENT" } }),
    db.user.count({ where: { isBlocked: false, role: "TEACHER" } }),
    db.group.count({ where: { archivedAt: null } }),
    db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "Lesson" WHERE coalesce("settings"->>'practice', 'false') <> 'true'`.then((r) => r[0]?.n ?? 0),
    db.attempt.count(),
    db.scenario.count({ where: { status: "APPROVED" } }),
  ]);
  return { users, students, teachers, groups, lessons, attempts, scenarios };
}
