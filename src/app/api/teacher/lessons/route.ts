import { db } from "@/lib/db";
import { lessonSnapshot, resolveLessonInput, seatRows } from "@/lib/lessons/save";
import { auditBy, jsonError, lessonScope, readJson, teacherApi } from "@/lib/teacher/access";

export async function GET() {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const lessons = await db.lesson.findMany({
    where: lessonScope(user),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      status: true,
      createdAt: true,
      startedAt: true,
      finishedAt: true,
      group: { select: { id: true, name: true } },
      _count: { select: { seats: true, attempts: true } },
    },
  });
  return Response.json({ lessons });
}

export async function POST(request: Request) {
  const user = await teacherApi();
  if (user instanceof Response) return user;
  const resolved = await resolveLessonInput(user, await readJson(request));
  if (!resolved.ok) return jsonError(resolved.error);
  const { title, groupId, settings, seats } = resolved.data;

  const lesson = await db.$transaction(async (tx) => {
    const created = await tx.lesson.create({ data: { title, groupId, settings, teacherId: user.id } });
    await tx.seat.createMany({ data: seatRows(created.id, seats) });
    return created;
  });
  await auditBy(user, request, {
    action: "lesson.create",
    entity: "Lesson",
    entityId: lesson.id,
    after: lessonSnapshot(lesson, seats),
  });
  return Response.json({ id: lesson.id }, { status: 201 });
}
