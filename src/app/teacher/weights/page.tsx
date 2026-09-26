import { PageHeader } from "@/components/ui";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { readCriteria, readOverrides } from "@/lib/review/draft";
import { getActiveWeights } from "@/lib/scoring/weights";
import { attemptScope } from "@/lib/teacher/access";
import { WeightsPanel, type PreviewAttempt } from "./WeightsPanel";

export default async function WeightsPage() {
  const user = await requireUser(["TEACHER", "ADMIN"]);
  const [active, rows, running] = await Promise.all([
    getActiveWeights(),
    db.attempt.findMany({
      where: attemptScope(user),
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        kind: true,
        criteria: true,
        override: true,
        reviewStatus: true,
        lesson: { select: { id: true, title: true, startedAt: true } },
        student: { select: { id: true, fullName: true } },
      },
    }),
    db.lesson.findFirst({ where: { status: "RUNNING" }, select: { title: true } }),
  ]);

  // Only what the score needs travels to the browser.
  const attempts: PreviewAttempt[] = rows.map((a) => ({
    id: a.id,
    kind: a.kind,
    reviewed: a.reviewStatus !== "PENDING",
    lessonId: a.lesson.id,
    lessonTitle: a.lesson.title,
    studentId: a.student.id,
    student: a.student.fullName,
    criteria: readCriteria(a.criteria).map((c) => ({ code: c.code, group: c.group, ok: c.ok, critical: c.critical, title: "", source: c.source })),
    override: readOverrides(a.override),
  }));

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Веса оценки"
        subtitle="Двигайте ползунки — баллы всех уже сданных попыток пересчитываются сразу, до сохранения. Веса общие для всех занятий."
      />
      <WeightsPanel saved={active.weights} savedName={active.name} attempts={attempts} runningLesson={running?.title ?? null} />
    </div>
  );
}
