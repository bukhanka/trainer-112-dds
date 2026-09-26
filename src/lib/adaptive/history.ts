/**
 * A student's attempts with everything the level and the forecast need: score and review state,
 * scenario difficulty, and the time against the norm (the same definition as in the lesson report:
 * 112 — card typing, ДДС — «Добавлена» → «Принята / Не принята»).
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import { db } from "@/lib/db";
import { lessonSettingsSchema } from "@/lib/lessons/settings";
import type { ForecastAttempt } from "./forecast";
import type { RatingAttempt } from "./rating";

type Client = PrismaClient | Prisma.TransactionClient;

const historySelect = {
  id: true,
  studentId: true,
  lessonId: true,
  kind: true,
  score: true,
  reviewStatus: true,
  createdAt: true,
  reviewedAt: true,
  lesson: { select: { title: true, startedAt: true, settings: true } },
  scenario: { select: { difficulty: true } },
  incident: { select: { createdAt: true, openedAt: true, savedAt: true } },
  incidentService: {
    select: { addedAt: true, events: { where: { status: { in: ["ACCEPTED", "REJECTED"] } }, orderBy: { at: "asc" }, take: 1, select: { at: true } } },
  },
} satisfies Prisma.AttemptSelect;

type Row = Prisma.AttemptGetPayload<{ select: typeof historySelect }>;

export type HistoryAttempt = ForecastAttempt &
  RatingAttempt & {
    lessonId: string;
    studentId: string;
    lessonTitle: string;
    lessonSettings: unknown;
  };

function normsOf(settings: unknown): { typingSec: number; ackSec: number } {
  const parsed = lessonSettingsSchema.safeParse(settings ?? {});
  const s = parsed.success ? parsed.data : lessonSettingsSchema.parse({});
  return { typingSec: s.typingSec, ackSec: s.ackSec };
}

const seconds = (from: Date, to: Date) => Math.round((to.getTime() - from.getTime()) / 1000);

export function toHistoryAttempt(r: Row): HistoryAttempt {
  const norms = normsOf(r.lesson?.settings);
  let timeSec: number | null = null;
  if (r.kind === "DDS" && r.incidentService) {
    const answer = r.incidentService.events?.[0];
    if (answer) timeSec = seconds(r.incidentService.addedAt, answer.at);
  } else if (r.kind === "OP112" && r.incident?.savedAt) {
    timeSec = seconds(r.incident.openedAt ?? r.incident.createdAt, r.incident.savedAt);
  }
  return {
    id: r.id,
    studentId: r.studentId,
    lessonId: r.lessonId,
    lessonTitle: r.lesson?.title ?? "",
    lessonStart: r.lesson?.startedAt ?? null,
    lessonSettings: r.lesson?.settings ?? null,
    kind: r.kind,
    score: r.score,
    reviewStatus: r.reviewStatus,
    createdAt: r.createdAt,
    reviewedAt: r.reviewedAt,
    difficulty: r.scenario?.difficulty ?? null,
    timeSec,
    normSec: r.kind === "OP112" ? norms.typingSec : norms.ackSec,
  };
}

/**
 * Attempts of these students, grouped by student. `scope` narrows them further — a teacher reads
 * only the attempts of own lessons, the same rule as everywhere in the cabinet.
 */
export async function loadHistory(studentIds: string[], opts: { scope?: Prisma.AttemptWhereInput; client?: Client } = {}): Promise<Map<string, HistoryAttempt[]>> {
  const ids = [...new Set(studentIds)];
  const out = new Map<string, HistoryAttempt[]>(ids.map((id) => [id, []]));
  if (!ids.length) return out;
  const rows = await (opts.client ?? db).attempt.findMany({
    where: { studentId: { in: ids }, ...opts.scope },
    orderBy: { createdAt: "asc" },
    select: historySelect,
  });
  for (const r of rows) out.get(r.studentId)?.push(toHistoryAttempt(r));
  return out;
}
