import type { Lesson } from "@prisma/client";
import { db } from "@/lib/db";
import { parseTeacherSettings } from "@/lib/lessons/form";
import { readCriteria, readOverrides } from "@/lib/review/draft";
import { passRulesOf } from "@/lib/scoring/pass";
import type { ReportInput } from "./lesson";


/** Rows of one lesson for the report; the caller has checked access to the lesson. */
export async function loadReportInput(lesson: Lesson): Promise<ReportInput> {
  const settings = parseTeacherSettings(lesson.settings);
  const [seats, attempts] = await Promise.all([
    db.seat.findMany({
      where: { lessonId: lesson.id },
      orderBy: { createdAt: "asc" },
      include: { student: { select: { fullName: true } }, service: { select: { shortName: true } } },
    }),
    db.attempt.findMany({
      where: { lessonId: lesson.id },
      orderBy: { createdAt: "asc" },
      include: {
        scenario: { select: { title: true } },
        incident: { select: { number: true, createdAt: true, openedAt: true, savedAt: true } },
        incidentService: { select: { addedAt: true, events: { orderBy: { at: "asc" }, select: { status: true, at: true, seatId: true } } } },
      },
    }),
  ]);

  return {
    norms: { ackSec: settings.ackSec, typingSec: settings.typingSec },
    pass: passRulesOf(lesson.settings),
    seats: seats.map((s) => ({
      id: s.id,
      label: s.label ?? "Место",
      role: s.role,
      studentId: s.studentId,
      studentName: s.student.fullName,
      serviceName: s.service?.shortName ?? null,
    })),
    attempts: attempts.map((a) => {
      let timeSec: number | null = null;
      let actions = 0;
      if (a.kind === "DDS" && a.incidentService) {
        // «Добавлена» → the card opened: the customer's 30-second norm.
        const opened = a.incidentService.events.find((e) => e.status !== "ADDED");
        if (opened) timeSec = Math.round((opened.at.getTime() - a.incidentService.addedAt.getTime()) / 1000);
        actions = a.incidentService.events.filter((e) => e.seatId === a.seatId && e.status !== "ADDED").length;
      } else if (a.kind === "OP112" && a.incident?.savedAt) {
        timeSec = Math.round((a.incident.savedAt.getTime() - (a.incident.openedAt ?? a.incident.createdAt).getTime()) / 1000);
        actions = 1;
      }
      return {
        id: a.id,
        seatId: a.seatId,
        studentId: a.studentId,
        kind: a.kind,
        reviewStatus: a.reviewStatus,
        score: a.score,
        criteria: readCriteria(a.criteria),
        override: readOverrides(a.override),
        timeSec,
        actions,
        incidentNumber: a.incident?.number ?? null,
        scenarioTitle: a.scenario?.title ?? null,
        createdAt: a.createdAt,
        teacherComment: a.teacherComment,
      };
    }),
  };
}
