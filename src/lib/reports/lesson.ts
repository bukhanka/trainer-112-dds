/**
 * Lesson report: who, where, how fast against the norm, which checks failed, the score — only for
 * attempts the teacher has confirmed (a draft never reaches a report). Pure function over plain rows.
 */
import { applyOverrides, WEIGHT_GROUPS, type CriterionResult, type Overrides, type WeightGroup } from "@/lib/scoring/score";

export type ReportAttempt = {
  id: string;
  seatId: string;
  studentId: string;
  kind: "OP112" | "DDS";
  reviewStatus: "PENDING" | "CONFIRMED" | "OVERRIDDEN";
  score: number | null;
  criteria: CriterionResult[];
  override: Overrides | null;
  /** 112: card typing time; ДДС: «Добавлена» → «Принята / Не принята». */
  timeSec: number | null;
  actions: number;
  incidentNumber: number | null;
  scenarioTitle: string | null;
  createdAt: Date;
  teacherComment: string | null;
};

export type ReportInput = {
  norms: { ackSec: number; typingSec: number };
  seats: { id: string; label: string; role: "OP112" | "DDS"; studentId: string; studentName: string; serviceName: string | null }[];
  attempts: ReportAttempt[];
};

export type Readiness = { label: string; tone: "green" | "blue" | "amber" | "red" };

export type StudentRow = {
  studentId: string;
  name: string;
  seat: string;
  role: "OP112" | "DDS";
  service: string | null;
  reviewed: number;
  pending: number;
  timeLabel: string; // «набор карточки» / «ответ»
  avgTimeSec: number | null;
  normSec: number;
  deltaSec: number | null;
  lateCount: number;
  actions: number;
  errors: number;
  textErrors: number;
  critical: number;
  avgScore: number | null;
  readiness: Readiness | null;
  topFailed: { title: string; count: number }[];
  cleanGroups: WeightGroup[];
};

export type CheckStat = { code: string; title: string; group: WeightGroup; failed: number; applicable: number; rate: number };

export type HeatCell = { group: WeightGroup; failed: number; applicable: number; rate: number | null };

export type LessonReport = {
  summary: {
    students: number;
    reviewed: number;
    pending: number;
    avgScore: number | null;
    agreement: { checks: number; changed: number; rate: number | null; aiChecks: number; aiChanged: number };
  };
  students: StudentRow[];
  leaders: { row: StudentRow; why: string }[];
  laggards: { row: StudentRow; why: string }[];
  typical: CheckStat[];
  insight: string;
  heat: { groups: WeightGroup[]; rows: { studentId: string; name: string; cells: HeatCell[] }[] };
  attempts: (ReportAttempt & { student: string; seat: string; normSec: number; failedTitles: string[] })[];
};

export function readiness(score: number | null): Readiness | null {
  if (score == null) return null;
  if (score >= 85) return { label: "готов к самостоятельной работе", tone: "green" };
  if (score >= 70) return { label: "уверенно, есть поправки", tone: "blue" };
  if (score >= 50) return { label: "нужна практика", tone: "amber" };
  return { label: "нужен разбор с преподавателем", tone: "red" };
}

const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
const GROUPS = Object.keys(WEIGHT_GROUPS) as WeightGroup[];

export function buildLessonReport(input: ReportInput): LessonReport {
  const reviewed = input.attempts.filter((a) => a.reviewStatus !== "PENDING");
  const checksOf = (a: ReportAttempt) => applyOverrides(a.criteria, a.override);

  const students: StudentRow[] = input.seats.map((seat) => {
    const mine = reviewed.filter((a) => a.seatId === seat.id);
    const normSec = seat.role === "OP112" ? input.norms.typingSec : input.norms.ackSec;
    const times = mine.flatMap((a) => (a.timeSec == null ? [] : [a.timeSec]));
    const avgTime = mean(times);
    const checks = mine.flatMap(checksOf);
    const failed = checks.filter((c) => c.ok === false);
    const counts = new Map<string, number>();
    for (const c of failed) counts.set(c.title, (counts.get(c.title) ?? 0) + 1);
    const scores = mine.flatMap((a) => (a.score == null ? [] : [a.score]));
    const avgScore = mean(scores);
    return {
      studentId: seat.studentId,
      name: seat.studentName,
      seat: seat.label,
      role: seat.role,
      service: seat.serviceName,
      reviewed: mine.length,
      pending: input.attempts.filter((a) => a.seatId === seat.id && a.reviewStatus === "PENDING").length,
      timeLabel: seat.role === "OP112" ? "набор карточки" : "ответ «Принята»",
      avgTimeSec: avgTime,
      normSec,
      deltaSec: avgTime == null ? null : avgTime - normSec,
      lateCount: times.filter((t) => t > normSec).length,
      actions: mine.reduce((a, x) => a + x.actions, 0),
      errors: failed.length,
      textErrors: failed.filter((c) => c.group === "literacy").length,
      critical: failed.filter((c) => c.critical).length,
      avgScore,
      readiness: readiness(avgScore),
      topFailed: [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([title, count]) => ({ title, count })),
      cleanGroups: GROUPS.filter((g) => checks.some((c) => c.group === g && c.ok !== null) && !checks.some((c) => c.group === g && c.ok === false)),
    };
  });

  // Typical errors of the group: failure rate of every check among the attempts where it applied.
  const stats = new Map<string, CheckStat>();
  for (const a of reviewed) {
    for (const c of checksOf(a)) {
      if (c.ok === null) continue;
      const s = stats.get(c.code) ?? { code: c.code, title: c.title, group: c.group, failed: 0, applicable: 0, rate: 0 };
      s.applicable++;
      if (c.ok === false) s.failed++;
      stats.set(c.code, s);
    }
  }
  const typical = [...stats.values()]
    .map((s) => ({ ...s, rate: s.applicable ? Math.round((s.failed / s.applicable) * 100) : 0 }))
    .filter((s) => s.failed > 0)
    // How many times the group failed matters more than a single 1-of-1.
    .sort((a, b) => b.failed - a.failed || b.rate - a.rate);

  const ranked = students.filter((s) => s.avgScore != null).sort((a, b) => b.avgScore! - a.avgScore! || a.errors - b.errors);
  const leadCount = Math.min(3, Math.ceil(ranked.length / 2));
  const leaders = ranked.slice(0, leadCount).map((row) => ({ row, why: leaderWhy(row) }));
  const laggards = ranked
    .slice(leadCount)
    .slice(-3)
    .reverse()
    .map((row) => ({ row, why: laggardWhy(row) }));

  // How often the teacher kept the draft verdict: the «service vs real» agreement.
  let checks = 0;
  let changed = 0;
  let aiChecks = 0;
  let aiChanged = 0;
  for (const a of reviewed) {
    for (const c of a.criteria) {
      const flipped = Boolean(a.override && c.code in a.override && a.override[c.code] !== c.ok);
      checks++;
      if (flipped) changed++;
      if (c.source === "ai") {
        aiChecks++;
        if (flipped) aiChanged++;
      }
    }
  }

  const byStudentChecks = new Map<string, CriterionResult[]>();
  for (const a of reviewed) byStudentChecks.set(a.studentId, [...(byStudentChecks.get(a.studentId) ?? []), ...checksOf(a)]);
  const heatGroups = GROUPS.filter((g) => reviewed.some((a) => checksOf(a).some((c) => c.group === g && c.ok !== null)));

  const seatOf = new Map(input.seats.map((s) => [s.id, s]));
  return {
    summary: {
      students: students.length,
      reviewed: reviewed.length,
      pending: input.attempts.length - reviewed.length,
      avgScore: mean(reviewed.flatMap((a) => (a.score == null ? [] : [a.score]))),
      agreement: { checks, changed, rate: checks ? Math.round(((checks - changed) / checks) * 100) : null, aiChecks, aiChanged },
    },
    students,
    leaders,
    laggards,
    typical,
    insight: insightText(typical),
    heat: {
      groups: heatGroups,
      rows: students
        .filter((s) => s.reviewed > 0)
        .map((s) => {
          const list = byStudentChecks.get(s.studentId) ?? [];
          return {
            studentId: s.studentId,
            name: s.name,
            cells: heatGroups.map((g) => {
              const inGroup = list.filter((c) => c.group === g && c.ok !== null);
              const failed = inGroup.filter((c) => c.ok === false).length;
              return { group: g, failed, applicable: inGroup.length, rate: inGroup.length ? Math.round((failed / inGroup.length) * 100) : null };
            }),
          };
        }),
    },
    // Drafts never reach a report: an unconfirmed attempt is not exported even without its score.
    attempts: reviewed.map((a) => {
      const seat = seatOf.get(a.seatId);
      return {
        ...a,
        student: seat?.studentName ?? "",
        seat: seat?.label ?? "",
        normSec: a.kind === "OP112" ? input.norms.typingSec : input.norms.ackSec,
        failedTitles: checksOf(a)
          .filter((c) => c.ok === false)
          .map((c) => c.title),
      };
    }),
  };
}

function leaderWhy(row: StudentRow): string {
  const parts: string[] = [];
  if (!row.errors) parts.push("ни одной ошибки");
  else if (row.cleanGroups.length) parts.push(`без ошибок: ${row.cleanGroups.map((g) => WEIGHT_GROUPS[g].split(":")[0].toLowerCase()).join(", ")}`);
  if (row.deltaSec != null && row.deltaSec <= 0) parts.push(`в нормативе по времени (${row.timeLabel})`);
  if (row.errors && row.topFailed[0]) parts.push(`подтянуть: «${row.topFailed[0].title}»`);
  return parts.join("; ") || "стабильная работа";
}

function laggardWhy(row: StudentRow): string {
  const parts = row.topFailed.map((f) => `«${f.title}»${f.count > 1 ? ` ×${f.count}` : ""}`);
  if (row.critical) parts.unshift(`критичных ошибок: ${row.critical}`);
  if (row.lateCount) parts.push(`опозданий по времени: ${row.lateCount}`);
  return parts.join("; ") || "мало подтверждённых попыток";
}

function insightText(typical: CheckStat[]): string {
  const notable = typical.filter((s) => s.failed >= 2 || s.rate >= 50).slice(0, 3);
  if (!notable.length) return typical.length ? "Типичных ошибок нет: каждую проверку провалили не больше одного раза." : "Ошибок в подтверждённых попытках нет.";
  const list = notable.map((s) => `«${s.title}» — ${s.failed} из ${s.applicable}`).join(", ");
  return `Сегодня группа чаще всего ошибается: ${list}. Начните следующее занятие с разбора этих ошибок.`;
}
