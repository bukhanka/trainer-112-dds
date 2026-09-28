/**
 * «Сертификат о прохождении занятия» (ТЗ: PDF для сертификатов). A student gets it for a lesson of a teacher when the
 * lesson is over, the teacher has checked every attempt of the student there and every one of them passed the lesson's
 * criteria («зачтено»: the score not lower than N, no more critical errors than allowed). The score on it is the average
 * of the confirmed attempts. Nothing is stored: like «зачтено», it follows the confirmed attempts, so a decision the
 * teacher takes back takes the certificate back too. A self-practice gives none.
 *
 * The page prints on A4 and the browser saves it as PDF (src/components/Certificate.tsx) — no PDF library.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { countLabel } from "@/lib/format";
import { isPractice } from "@/lib/lessons/form";
import { readCriteria, readOverrides } from "@/lib/review/draft";
import { describePassRules, passRulesOf, passVerdict, type PassRules } from "@/lib/scoring/pass";
import type { CriterionResult, Overrides } from "@/lib/scoring/score";

export type CertificateAttempt = {
  reviewStatus: "PENDING" | "CONFIRMED" | "OVERRIDDEN";
  score: number | null;
  criteria: CriterionResult[];
  override: Overrides | null;
};

export type CertificateVerdict = { ok: true; score: number; passed: number } | { ok: false; reason: string };

/** Pure: does the student's work in the lesson earn the certificate, and with what score. */
export function certificateVerdict(lesson: { status: string; settings: unknown }, attempts: CertificateAttempt[], rules: PassRules): CertificateVerdict {
  if (isPractice(lesson.settings)) return { ok: false, reason: "За самостоятельную тренировку сертификат не выдаётся." };
  if (lesson.status !== "FINISHED") return { ok: false, reason: "Занятие ещё не завершено." };
  if (!attempts.length) return { ok: false, reason: "На занятии нет попыток ученика." };
  const pending = attempts.filter((a) => a.reviewStatus === "PENDING").length;
  if (pending) return { ok: false, reason: `Преподаватель ещё не проверил ${countLabel(pending, ["попытку", "попытки", "попыток"])}.` };
  const verdicts = attempts.flatMap((a) => {
    const v = passVerdict(a.score, a.criteria, a.override, rules);
    return v ? [v] : [];
  });
  if (!verdicts.length) return { ok: false, reason: "В попытках нечего оценить: балла нет." };
  const failed = verdicts.filter((v) => !v.passed).length;
  if (failed) return { ok: false, reason: `Не зачтено ${countLabel(failed, ["попытка", "попытки", "попыток"])} из ${verdicts.length} (зачёт: ${describePassRules(rules)}).` };
  const scores = attempts.flatMap((a) => (a.score == null ? [] : [a.score]));
  return { ok: true, score: Math.round(scores.reduce((s, x) => s + x, 0) / scores.length), passed: verdicts.length };
}

/** «прошёл» / «прошла» by the patronymic; «прошёл(а)» when it does not tell. */
export function passedWord(fullName: string): string {
  const last = fullName.trim().split(/\s+/).at(-1)?.toLowerCase() ?? "";
  if (/(вич|ич|оглы|улы)$/.test(last)) return "прошёл";
  if (/(вна|чна|кызы|гызы)$/.test(last)) return "прошла";
  return "прошёл(а)";
}

/** A number a person can quote: the lesson's date and the tails of the two ids — «20260921-K3Q9-X2A7». */
export function certificateNumber(date: Date | null, lessonId: string, studentId: string): string {
  const d = date ?? new Date(0);
  const ymd = d.toLocaleDateString("sv-SE", { timeZone: "Europe/Moscow" }).replace(/-/g, "");
  const tail = (id: string) => id.replace(/[^a-z0-9]/gi, "").slice(-4).toUpperCase();
  return `${ymd}-${tail(lessonId)}-${tail(studentId)}`;
}

export type CertificateData = {
  number: string;
  lessonId: string;
  lessonTitle: string;
  date: string | null;
  groupName: string | null;
  teacherName: string;
  studentId: string;
  studentName: string;
  role: "OP112" | "DDS";
  serviceName: string | null;
  rules: PassRules;
  verdict: CertificateVerdict;
  /** When it was earned: the last decision of the teacher on the student's attempts (the lesson's end at the latest). */
  issuedAt: string | null;
};

const seatSelect = {
  role: true,
  service: { select: { shortName: true } },
  student: { select: { fullName: true } },
  lesson: {
    select: {
      id: true,
      title: true,
      status: true,
      settings: true,
      startedAt: true,
      finishedAt: true,
      group: { select: { name: true } },
      teacher: { select: { fullName: true } },
    },
  },
} satisfies Prisma.SeatSelect;

/**
 * The certificate of one student in one lesson, or null when the student had no place there (another student's lesson
 * looks exactly like a missing one). The caller decides who may ask: the student — only with own id; a teacher — only
 * after findLesson (own lessons, an administrator all).
 */
export async function loadCertificate(lessonId: string, studentId: string): Promise<CertificateData | null> {
  const seat = await db.seat.findFirst({ where: { lessonId, studentId }, orderBy: { createdAt: "asc" }, select: seatSelect });
  if (!seat) return null;
  const rows = await db.attempt.findMany({ where: { lessonId, studentId }, select: { reviewStatus: true, score: true, criteria: true, override: true, reviewedAt: true } });
  const rules = passRulesOf(seat.lesson.settings);
  const date = seat.lesson.startedAt ?? seat.lesson.finishedAt;
  const decided = rows.flatMap((a) => (a.reviewedAt ? [a.reviewedAt.getTime()] : []));
  const issuedAt = decided.length ? new Date(Math.max(...decided)) : seat.lesson.finishedAt;
  return {
    number: certificateNumber(date, lessonId, studentId),
    lessonId,
    lessonTitle: seat.lesson.title,
    date: date?.toISOString() ?? null,
    groupName: seat.lesson.group?.name ?? null,
    teacherName: seat.lesson.teacher.fullName,
    studentId,
    studentName: seat.student.fullName,
    role: seat.role,
    serviceName: seat.role === "DDS" ? (seat.service?.shortName ?? null) : null,
    rules,
    verdict: certificateVerdict(
      seat.lesson,
      rows.map((a) => ({ reviewStatus: a.reviewStatus, score: a.score, criteria: readCriteria(a.criteria), override: readOverrides(a.override) })),
      rules,
    ),
    issuedAt: issuedAt?.toISOString() ?? null,
  };
}

export type CertificateItem = { lessonId: string; title: string; date: string | null; score: number };

/** The student's certificates, newest first — for «Мои результаты». Only the student's own places and attempts. */
export async function studentCertificates(studentId: string): Promise<CertificateItem[]> {
  const seats = await db.seat.findMany({
    where: { studentId, lesson: { status: "FINISHED", teacherId: { not: studentId } } },
    select: { lesson: { select: { id: true, title: true, status: true, settings: true, startedAt: true, finishedAt: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const lessons = seats.map((s) => s.lesson).filter((l) => !isPractice(l.settings));
  if (!lessons.length) return [];
  const rows = await db.attempt.findMany({
    where: { studentId, lessonId: { in: lessons.map((l) => l.id) } },
    select: { lessonId: true, reviewStatus: true, score: true, criteria: true, override: true },
  });
  const out: CertificateItem[] = [];
  for (const l of new Map(lessons.map((x) => [x.id, x])).values()) {
    const mine = rows.filter((r) => r.lessonId === l.id).map((a) => ({ reviewStatus: a.reviewStatus, score: a.score, criteria: readCriteria(a.criteria), override: readOverrides(a.override) }));
    const v = certificateVerdict(l, mine, passRulesOf(l.settings));
    if (v.ok) out.push({ lessonId: l.id, title: l.title, date: (l.startedAt ?? l.finishedAt)?.toISOString() ?? null, score: v.score });
  }
  return out.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
}
