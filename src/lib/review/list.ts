import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { DEFAULT_PASS, passVerdict, type PassRules, type PassVerdict } from "@/lib/scoring/pass";
import { applyOverrides } from "@/lib/scoring/score";
import { teacherEdited } from "./bulk";
import { readCriteria, readOverrides } from "./draft";

export type AttemptFilters = { status?: string | null; kind?: string | null; seat?: string | null };

export type AttemptListItem = {
  id: string;
  kind: "OP112" | "DDS";
  student: string;
  seat: string | null;
  seatId: string;
  scenario: string | null;
  incidentNumber: number | null;
  createdAt: Date;
  reviewStatus: "PENDING" | "CONFIRMED" | "OVERRIDDEN";
  score: number | null;
  failed: number;
  total: number;
  critical: boolean;
  /** Returned to review after the teacher changed checks or wrote a comment: decided one by one, not in a list. */
  edited: boolean;
  /** «зачтено / не зачтено» by the lesson's criteria (a draft verdict while the attempt is on review). */
  pass: PassVerdict | null;
};

export function attemptWhere(lessonId: string, f: AttemptFilters): Prisma.AttemptWhereInput {
  const where: Prisma.AttemptWhereInput = { lessonId };
  if (f.status === "PENDING" || f.status === "CONFIRMED" || f.status === "OVERRIDDEN") where.reviewStatus = f.status;
  if (f.kind === "OP112" || f.kind === "DDS") where.kind = f.kind;
  if (f.seat) where.seatId = f.seat;
  return where;
}

/** Attempts of one lesson (the caller has already checked the lesson belongs to the teacher). */
export async function listLessonAttempts(lessonId: string, f: AttemptFilters, rules: PassRules = DEFAULT_PASS): Promise<AttemptListItem[]> {
  const rows = await db.attempt.findMany({
    where: attemptWhere(lessonId, f),
    orderBy: [{ createdAt: "asc" }],
    include: {
      student: { select: { fullName: true } },
      seat: { select: { label: true } },
      scenario: { select: { title: true } },
      incident: { select: { number: true } },
    },
  });
  return rows.map((a) => {
    const raw = readCriteria(a.criteria);
    const overrides = readOverrides(a.override);
    const checks = applyOverrides(raw, overrides);
    return {
      id: a.id,
      kind: a.kind,
      student: a.student.fullName,
      seat: a.seat.label,
      seatId: a.seatId,
      scenario: a.scenario?.title ?? null,
      incidentNumber: a.incident?.number ?? null,
      createdAt: a.createdAt,
      reviewStatus: a.reviewStatus,
      score: a.score,
      failed: checks.filter((c) => c.ok === false).length,
      total: checks.filter((c) => c.ok !== null).length,
      critical: checks.some((c) => c.critical && c.ok === false),
      edited: teacherEdited({ override: overrides, teacherComment: a.teacherComment }),
      pass: passVerdict(a.score, raw, overrides, rules),
    };
  });
}
