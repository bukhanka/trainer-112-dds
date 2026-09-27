/**
 * «Мои задания»: where the student works now — own places in running and draft lessons of the teachers
 * (a self-practice is not an assignment), with the tasks the teacher gave the place. Every query is
 * filtered by the student's own id; only titles of the tasks leave, never the reference answers.
 */
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { isPractice } from "@/lib/lessons/form";
import { adaptiveChoice, lessonSettingsSchema } from "@/lib/lessons/settings";

export type AssignmentTask = { id: string; title: string; category: string; difficulty: number };

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
  tasks: AssignmentTask[];
  /** Where the cards come from when the place has no tasks: by the student's level, by categories, or any approved. */
  source: "tasks" | "level" | "categories" | "all";
  categories: string[];
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

/** Pure: own places → what the cabinet shows; a running lesson first, then the planned ones. */
export function buildAssignments(seats: SeatRow[], scenarios: AssignmentTask[]): Assignment[] {
  const byId = new Map(scenarios.map((s) => [s.id, s]));
  return seats
    .filter((s) => (s.lesson.status === "RUNNING" || s.lesson.status === "DRAFT") && !isPractice(s.lesson.settings))
    .map((s): Assignment => {
      const parsed = lessonSettingsSchema.safeParse(s.lesson.settings ?? {});
      const categories = parsed.success ? parsed.data.categories : [];
      const tasks = s.scenarioIds.map((id) => byId.get(id)).filter((t): t is AssignmentTask => !!t);
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
        tasks,
        source: tasks.length ? "tasks" : adaptiveChoice(s.lesson.settings) ? "level" : categories.length ? "categories" : "all",
        categories,
      };
    })
    .sort((a, b) => Number(b.status === "RUNNING") - Number(a.status === "RUNNING") || (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}

export async function getAssignments(studentId: string): Promise<Assignment[]> {
  const seats = await db.seat.findMany({
    where: { studentId, lesson: { status: { in: ["RUNNING", "DRAFT"] } } },
    orderBy: { createdAt: "desc" },
    take: 30,
    select: seatSelect,
  });
  const ids = [...new Set(seats.flatMap((s) => s.scenarioIds))];
  const scenarios = ids.length
    ? await db.scenario.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, category: true, difficulty: true } })
    : [];
  return buildAssignments(seats, scenarios);
}
