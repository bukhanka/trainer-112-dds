import type { Lesson } from "@prisma/client";
import { db } from "@/lib/db";
import { parseTeacherSettings } from "@/lib/lessons/form";
import { readCriteria, readOverrides } from "@/lib/review/draft";
import { formatAddress } from "./address";
import type { BoardInput } from "./state";

/** Reads everything the board needs for one lesson in five queries. */
export async function loadBoardInput(lesson: Lesson): Promise<BoardInput> {
  const settings = parseTeacherSettings(lesson.settings);
  const [seats, incidents, calls, attempts] = await Promise.all([
    db.seat.findMany({
      where: { lessonId: lesson.id },
      orderBy: { createdAt: "asc" },
      include: { student: { select: { fullName: true } }, service: { select: { shortName: true } } },
    }),
    db.incident.findMany({
      where: { lessonId: lesson.id },
      orderBy: { createdAt: "asc" },
      include: {
        scenario: { select: { title: true } },
        services: {
          orderBy: { addedAt: "asc" },
          include: {
            service: { select: { shortName: true, delivery: true, visible: true } },
            events: { orderBy: { at: "asc" }, select: { status: true, at: true, seatId: true } },
          },
        },
      },
    }),
    db.call.findMany({
      where: { lessonId: lesson.id },
      select: { seatId: true, kind: true, status: true, startedAt: true, answeredAt: true },
    }),
    db.attempt.findMany({
      where: { lessonId: lesson.id },
      select: { seatId: true, incidentServiceId: true, reviewStatus: true, score: true, criteria: true, override: true },
    }),
  ]);

  return {
    lesson: {
      status: lesson.status,
      startedAt: lesson.startedAt,
      finishedAt: lesson.finishedAt,
      ackSec: settings.ackSec,
      workSec: settings.workSec,
      typingSec: settings.typingSec,
    },
    seats: seats.map((s) => ({
      id: s.id,
      label: s.label ?? "Место",
      role: s.role,
      studentId: s.studentId,
      studentName: s.student.fullName,
      serviceId: s.serviceId,
      serviceName: s.service?.shortName ?? null,
      scenarioIds: s.scenarioIds,
    })),
    incidents: incidents.map((i) => ({
      id: i.id,
      number: i.number,
      scenarioId: i.scenarioId,
      title: i.scenario?.title ?? i.description?.slice(0, 80) ?? `Карточка ${i.number}`,
      address: formatAddress(i.address),
      source: i.source,
      createdBySeatId: i.createdBySeatId,
      createdAt: i.createdAt,
      openedAt: i.openedAt,
      savedAt: i.savedAt,
      plates: i.services.map((p) => ({
        id: p.id,
        serviceId: p.serviceId,
        serviceName: p.service.shortName,
        delivery: p.service.delivery,
        visible: p.service.visible,
        status: p.status,
        addedAt: p.addedAt,
        events: p.events,
      })),
    })),
    calls,
    attempts: attempts.map((a) => ({
      seatId: a.seatId,
      incidentServiceId: a.incidentServiceId,
      reviewStatus: a.reviewStatus,
      score: a.score,
      criteria: readCriteria(a.criteria),
      override: readOverrides(a.override),
    })),
  };
}
