/**
 * «Мои результаты» of a student. Every query is filtered by the student's own id, and an attempt the
 * teacher has not confirmed yet is shown only as «на проверке»: no score, no checks, no AI draft.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { GROUP_ADVICE, readCriteria, readOverrides } from "@/lib/review/draft";
import { applyOverrides, WEIGHT_GROUPS, type CriterionResult, type WeightGroup } from "@/lib/scoring/score";

export function ownAttemptsWhere(studentId: string): Prisma.AttemptWhereInput {
  return { studentId };
}

const listSelect = {
  id: true,
  kind: true,
  createdAt: true,
  reviewStatus: true,
  score: true,
  criteria: true,
  override: true,
  lesson: { select: { id: true, title: true, startedAt: true, settings: true } },
  scenario: { select: { title: true } },
  incident: { select: { number: true } },
} satisfies Prisma.AttemptSelect;

type Row = Prisma.AttemptGetPayload<{ select: typeof listSelect }>;

export type StudentAttemptItem = {
  id: string;
  kind: "OP112" | "DDS";
  createdAt: string;
  lessonId: string;
  lessonTitle: string;
  task: string | null;
  incidentNumber: number | null;
  status: "PENDING" | "CONFIRMED" | "OVERRIDDEN";
  /** Only for confirmed attempts. */
  score: number | null;
  failed: number | null;
};

export type StudentResults = {
  summary: { total: number; reviewed: number; pending: number; avgScore: number | null; lastLesson: number | null; prevLesson: number | null };
  progress: { lessonId: string; title: string; date: string; avgScore: number; attempts: number }[];
  recommendations: { group: WeightGroup; title: string; failed: number; advice: string; examples: string[] }[];
  attempts: StudentAttemptItem[];
};

const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);

/** Pure: turns the student's own rows into what the page shows. Draft verdicts never leave this function. */
export function buildStudentResults(rows: Row[]): StudentResults {
  const reviewed = rows.filter((r) => r.reviewStatus !== "PENDING");
  const checks = (r: Row) => applyOverrides(readCriteria(r.criteria), readOverrides(r.override));

  const byLesson = new Map<string, { title: string; date: Date; scores: number[] }>();
  for (const r of reviewed) {
    if (r.score == null) continue;
    const e = byLesson.get(r.lesson.id) ?? { title: r.lesson.title, date: r.lesson.startedAt ?? r.createdAt, scores: [] };
    e.scores.push(r.score);
    byLesson.set(r.lesson.id, e);
  }
  const progress = [...byLesson.entries()]
    .map(([lessonId, e]) => ({ lessonId, title: e.title, date: e.date.toISOString(), avgScore: mean(e.scores)!, attempts: e.scores.length }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const failedByGroup = new Map<WeightGroup, CriterionResult[]>();
  for (const r of [...reviewed].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())) {
    for (const c of checks(r)) {
      if (c.ok === false) failedByGroup.set(c.group, [...(failedByGroup.get(c.group) ?? []), c]);
    }
  }
  const recommendations = [...failedByGroup.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 3)
    .map(([group, list]) => ({
      group,
      title: WEIGHT_GROUPS[group],
      failed: list.length,
      advice: GROUP_ADVICE[group],
      examples: [...new Set(list.map((c) => (c.expected ? `${c.title}: ${c.expected}` : c.title)))].slice(0, 3),
    }));

  const scores = reviewed.flatMap((r) => (r.score == null ? [] : [r.score]));
  return {
    summary: {
      total: rows.length,
      reviewed: reviewed.length,
      pending: rows.length - reviewed.length,
      avgScore: mean(scores),
      lastLesson: progress.at(-1)?.avgScore ?? null,
      prevLesson: progress.at(-2)?.avgScore ?? null,
    },
    progress,
    recommendations,
    attempts: [...rows]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map((r) => {
        const done = r.reviewStatus !== "PENDING";
        return {
          id: r.id,
          kind: r.kind,
          createdAt: r.createdAt.toISOString(),
          lessonId: r.lesson.id,
          lessonTitle: r.lesson.title,
          task: r.scenario?.title ?? null,
          incidentNumber: r.incident?.number ?? null,
          status: r.reviewStatus,
          score: done ? r.score : null,
          failed: done ? checks(r).filter((c) => c.ok === false).length : null,
        };
      }),
  };
}

/** The login session asking: practice without a lesson belongs to one session (demo accounts are shared). */
export type ViewerSession = { practiceKey: string; sessionId: string | null };

/** Practice lesson started under another login session of the same account. */
export function isOtherSessionPractice(settings: unknown, viewer?: ViewerSession): boolean {
  if (!viewer) return false;
  const s = (settings ?? {}) as { practice?: boolean; practiceKey?: string; sessionId?: string };
  if (s.practiceKey) return s.practiceKey !== viewer.practiceKey;
  if (s.sessionId) return s.sessionId !== viewer.sessionId;
  return false;
}

export async function getStudentResults(studentId: string, viewer?: ViewerSession): Promise<StudentResults> {
  const rows = await db.attempt.findMany({ where: ownAttemptsWhere(studentId), orderBy: { createdAt: "asc" }, select: listSelect });
  return buildStudentResults(rows.filter((r) => !isOtherSessionPractice(r.lesson.settings, viewer)));
}

export type StudentAttemptDetail =
  | { status: "PENDING"; id: string; kind: "OP112" | "DDS"; createdAt: string; lessonTitle: string; task: string | null }
  | {
      status: "CONFIRMED" | "OVERRIDDEN";
      id: string;
      kind: "OP112" | "DDS";
      createdAt: string;
      lessonTitle: string;
      task: string | null;
      incidentNumber: number | null;
      score: number | null;
      teacherComment: string | null;
      checks: { code: string; group: WeightGroup; title: string; ok: boolean | null; critical: boolean; evidence: string | null; expected: string | null; changedByTeacher: boolean }[];
    };

/** One own attempt; another student's id resolves to null (404), exactly like a missing one. */
export async function getStudentAttempt(studentId: string, attemptId: string, viewer?: ViewerSession): Promise<StudentAttemptDetail | null> {
  const a = await db.attempt.findFirst({
    where: { id: attemptId, ...ownAttemptsWhere(studentId) },
    select: { ...listSelect, teacherComment: true },
  });
  if (!a || isOtherSessionPractice(a.lesson.settings, viewer)) return null;
  const base = { id: a.id, kind: a.kind, createdAt: a.createdAt.toISOString(), lessonTitle: a.lesson.title, task: a.scenario?.title ?? null };
  if (a.reviewStatus === "PENDING") return { status: "PENDING", ...base };
  const raw = readCriteria(a.criteria);
  const overrides = readOverrides(a.override);
  return {
    status: a.reviewStatus,
    ...base,
    incidentNumber: a.incident?.number ?? null,
    score: a.score,
    teacherComment: a.teacherComment,
    checks: applyOverrides(raw, overrides).map((c) => ({
      code: c.code,
      group: c.group,
      title: c.title,
      ok: c.ok,
      critical: Boolean(c.critical),
      evidence: c.evidence ?? null,
      expected: c.expected ?? null,
      changedByTeacher: Boolean(overrides && c.code in overrides),
    })),
  };
}
