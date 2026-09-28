/**
 * «Мои задания»: where the student works now — own places in running and draft lessons of the teachers
 * (a self-practice is not an assignment) and how many tasks the teacher gave the place. Every query is
 * filtered by the student's own id. Only the number of tasks leaves: a title («Дерутся в квартире»), a category
 * or a difficulty would tell the operator what happened before the call and the dispatcher what is in the card.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isPractice } from "@/lib/lessons/form";
import { adaptiveChoice, lessonSettingsSchema } from "@/lib/lessons/settings";

export type Assignment = {
  lessonId: string;
  lessonTitle: string;
  status: "RUNNING" | "DRAFT";
  startedAt: string | null;
  groupName: string | null;
  teacherName: string;
  role: "OP112" | "DDS";
  seatLabel: string | null;
  serviceName: string | null;
  /** How many tasks the teacher gave the place — never which ones. */
  taskCount: number;
  /** Where the cards come from when the place has no tasks: by the student's level, by categories, or any approved. */
  source: "tasks" | "level" | "categories" | "all";
  /** A ДДС place of a lesson where cards come from the 112 places: only them, or them as well. */
  from112: "only" | "also" | null;
};

const seatSelect = {
  role: true,
  label: true,
  scenarioIds: true,
  createdAt: true,
  service: { select: { shortName: true } },
  lesson: {
    select: {
      id: true,
      title: true,
      status: true,
      startedAt: true,
      settings: true,
      group: { select: { name: true } },
      teacher: { select: { fullName: true } },
    },
  },
} satisfies Prisma.SeatSelect;

type SeatRow = Prisma.SeatGetPayload<{ select: typeof seatSelect }>;

/** Pure: own places → what the cabinet shows; a running lesson first, then the planned ones. `existing` — task ids still in the library. */
export function buildAssignments(seats: SeatRow[], existing: Set<string>): Assignment[] {
  return seats
    .filter((s) => (s.lesson.status === "RUNNING" || s.lesson.status === "DRAFT") && !isPractice(s.lesson.settings))
    .map((s): Assignment => {
      const parsed = lessonSettingsSchema.safeParse(s.lesson.settings ?? {});
      const categories = parsed.success ? parsed.data.categories : [];
      const cardSource = parsed.success ? parsed.data.cardSource : "generated";
      const taskCount = s.scenarioIds.filter((id) => existing.has(id)).length;
      return {
        lessonId: s.lesson.id,
        lessonTitle: s.lesson.title,
        status: s.lesson.status as "RUNNING" | "DRAFT",
        startedAt: s.lesson.startedAt?.toISOString() ?? null,
        groupName: s.lesson.group?.name ?? null,
        teacherName: s.lesson.teacher.fullName,
        role: s.role,
        seatLabel: s.label,
        serviceName: s.role === "DDS" ? (s.service?.shortName ?? null) : null,
        taskCount,
        source: taskCount ? "tasks" : adaptiveChoice(s.lesson.settings) ? "level" : categories.length ? "categories" : "all",
        from112: s.role !== "DDS" ? null : cardSource === "students" ? "only" : cardSource === "mixed" ? "also" : null,
      };
    })
    .sort((a, b) => Number(b.status === "RUNNING") - Number(a.status === "RUNNING") || (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}

export async function getAssignments(studentId: string): Promise<Assignment[]> {
  const seats = await db.seat.findMany({
    // A ДДС self-practice belongs to the student themself: left out here, so dozens of practices on a
    // shared demo account never push the teacher's lessons out of the list.
    where: { studentId, lesson: { status: { in: ["RUNNING", "DRAFT"] }, teacherId: { not: studentId } } },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: seatSelect,
  });
  const ids = [...new Set(seats.flatMap((s) => s.scenarioIds))];
  const existing = ids.length ? await db.scenario.findMany({ where: { id: { in: ids } }, select: { id: true } }) : [];
  return buildAssignments(seats, new Set(existing.map((s) => s.id)));
}
