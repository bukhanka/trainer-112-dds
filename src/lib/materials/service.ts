/**
 * The library of materials (ТЗ п. 88 «загружать дополнительные ресурсы», п. 157, п. 181): a teacher uploads a
 * document or a picture, names it and says who sees it (src/lib/materials/access.ts); students open what is theirs.
 * Route handlers call these functions after the role check and write the audit journal with materialSnapshot().
 */
import { createHash } from "node:crypto";
import type { Material } from "@prisma/client";
import { db } from "@/lib/db";
import { detectMaterial, MATERIAL_KINDS, type MaterialKind } from "@/lib/files/detect";
import { cleanFileName, formatBytes, titleFromFileName } from "@/lib/files/names";
import { isPractice } from "@/lib/lessons/form";
import { AUDIENCE_LABEL, deleteRefusal, materialScope, type Audience, type Viewer } from "./access";
import { removeMaterialFile, saveMaterialFile } from "./storage";

export const MAX_FILE_MB = 20;
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
export const MAX_TITLE = 200;

/** The whole library at most (MATERIALS_MAX_TOTAL_MB, 2 ГБ by default): one careless upload spree must not fill the disk. */
export function libraryLimitBytes(): number {
  const mb = Number(process.env.MATERIALS_MAX_TOTAL_MB);
  return (Number.isFinite(mb) && mb > 0 ? mb : 2048) * 1024 * 1024;
}

type Fail = { ok: false; error: string; status: number };

/** The lessons a teacher gives materials to: own ones; an administrator — any. */
const ownLessons = (user: Viewer) => (user.role === "ADMIN" ? {} : { teacherId: user.id });
const fail = (error: string, status = 400): Fail => ({ ok: false, error, status });

export type MaterialItem = {
  id: string;
  title: string;
  fileName: string;
  kind: MaterialKind;
  kindLabel: string;
  size: string;
  audience: Audience;
  lesson: { id: string; title: string; status: string } | null;
  /** A lesson material whose lesson was deleted: only the uploader and the administrators see it. */
  lessonGone: boolean;
  ownerName: string;
  mine: boolean;
  canDelete: boolean;
  /** Opens in the browser (PDF, text, pictures); Office files are only downloaded. */
  opens: boolean;
  createdAt: string;
};

function asKind(kind: string): MaterialKind {
  return (kind in MATERIAL_KINDS ? kind : "pdf") as MaterialKind;
}

/** Everything the user may see, newest first; `lessonId` narrows to one lesson. */
export async function listMaterials(user: Viewer, filter: { lessonId?: string } = {}): Promise<MaterialItem[]> {
  const scope = await materialScope(user);
  const rows = await db.material.findMany({
    where: { AND: [scope, filter.lessonId ? { lessonId: filter.lessonId } : {}] },
    orderBy: { createdAt: "desc" },
  });
  const lessonIds = [...new Set(rows.map((r) => r.lessonId).filter((id): id is string => !!id))];
  const lessons = lessonIds.length ? await db.lesson.findMany({ where: { id: { in: lessonIds } }, select: { id: true, title: true, status: true } }) : [];
  const byId = new Map(lessons.map((l) => [l.id, l]));
  return rows.map((m) => {
    const kind = asKind(m.kind);
    const lesson = m.audience === "lesson" && m.lessonId ? (byId.get(m.lessonId) ?? null) : null;
    return {
      id: m.id,
      title: m.title,
      fileName: m.fileName,
      kind,
      kindLabel: MATERIAL_KINDS[kind].label,
      size: formatBytes(m.sizeBytes),
      audience: (m.audience as Audience) ?? "all",
      lesson: lesson ? { id: lesson.id, title: lesson.title, status: lesson.status } : null,
      lessonGone: m.audience === "lesson" && !lesson,
      ownerName: m.ownerName,
      mine: m.ownerId === user.id,
      canDelete: deleteRefusal(user, m) === null,
      opens: MATERIAL_KINDS[kind].inline,
      createdAt: m.createdAt.toISOString(),
    };
  });
}

/** One material the user may see, or null — a foreign one and a missing one look the same. */
export async function findVisibleMaterial(user: Viewer, id: string): Promise<Material | null> {
  if (!id || id.length > 64) return null;
  return db.material.findFirst({ where: { AND: [{ id }, await materialScope(user)] } });
}

export type LessonChoice = { id: string; title: string; status: string; groupName: string | null };

/** Lessons a material can be given to: the teacher's own class lessons (an administrator — all), newest first. */
export async function lessonChoices(user: Viewer): Promise<LessonChoice[]> {
  const rows = await db.lesson.findMany({
    where: ownLessons(user),
    orderBy: { createdAt: "desc" },
    take: 300,
    select: { id: true, title: true, status: true, settings: true, group: { select: { name: true } } },
  });
  return rows.filter((l) => !isPractice(l.settings)).map((l) => ({ id: l.id, title: l.title, status: l.status, groupName: l.group?.name ?? null }));
}

/** What the audit journal keeps about a material: enough to know what it was after it is gone. */
export function materialSnapshot(m: Pick<Material, "title" | "fileName" | "kind" | "sizeBytes" | "audience">, lessonTitle: string | null) {
  return {
    title: m.title,
    file: m.fileName,
    type: MATERIAL_KINDS[asKind(m.kind)].label,
    size: formatBytes(m.sizeBytes),
    access: AUDIENCE_LABEL[m.audience as Audience] ?? m.audience,
    ...(lessonTitle ? { lesson: lessonTitle } : {}),
  };
}

export type UploadInput = { title?: string | null; audience: Audience; lessonId?: string | null; fileName: string; bytes: Uint8Array };

/** Checks the file (type by name and content, size, room left) and the lesson, stores the file and its row. */
export async function uploadMaterial(user: Viewer & { fullName: string }, input: UploadInput): Promise<{ ok: true; material: Material; lessonTitle: string | null } | Fail> {
  if (user.role !== "TEACHER" && user.role !== "ADMIN") return fail("Недостаточно прав", 403);
  if (input.bytes.length > MAX_FILE_BYTES) return fail(`Файл больше ${MAX_FILE_MB} МБ — уменьшите его или разделите на части`, 413);
  const type = detectMaterial(input.fileName, input.bytes);
  if (!type.ok) return fail(type.error, 415);

  let lessonId: string | null = null;
  let lessonTitle: string | null = null;
  if (input.audience === "lesson") {
    if (!input.lessonId) return fail("Выберите занятие");
    const lesson = await db.lesson.findFirst({
      where: { id: input.lessonId, ...ownLessons(user) },
      select: { id: true, title: true, settings: true },
    });
    if (!lesson || isPractice(lesson.settings)) return fail("Занятие не найдено", 404);
    lessonId = lesson.id;
    lessonTitle = lesson.title;
  }

  const used = (await db.material.aggregate({ _sum: { sizeBytes: true } }))._sum.sizeBytes ?? 0;
  const limit = libraryLimitBytes();
  if (used + input.bytes.length > limit) {
    return fail(`Библиотека заполнена: занято ${formatBytes(used)} из ${formatBytes(limit)}. Удалите ненужные материалы или попросите администратора увеличить лимит`, 413);
  }

  const fileName = cleanFileName(input.fileName, type.ext);
  const title = [...(input.title?.replace(/\s+/g, " ").trim() || titleFromFileName(fileName))].slice(0, MAX_TITLE).join("");
  const storedName = await saveMaterialFile(input.bytes, type.ext);
  try {
    const material = await db.material.create({
      data: {
        title,
        fileName,
        storedName,
        kind: type.kind,
        mime: type.mime,
        sizeBytes: input.bytes.length,
        sha256: createHash("sha256").update(input.bytes).digest("hex"),
        audience: input.audience,
        lessonId,
        ownerId: user.id,
        ownerName: user.fullName,
      },
    });
    return { ok: true, material, lessonTitle };
  } catch (err) {
    await removeMaterialFile(storedName).catch(() => undefined);
    throw err;
  }
}

/** Deletes a material the user sees and may delete: the row first, then the file (a leftover file is harmless). */
export async function deleteMaterial(user: Viewer, id: string): Promise<{ ok: true; material: Material; lessonTitle: string | null } | Fail> {
  const material = await findVisibleMaterial(user, id);
  if (!material) return fail("Материал не найден", 404);
  const refusal = deleteRefusal(user, material);
  if (refusal) return fail(refusal.error, refusal.status);
  const gone = await db.material.deleteMany({ where: { id: material.id } });
  if (!gone.count) return fail("Материал уже удалён", 404);
  await removeMaterialFile(material.storedName).catch((err) => console.error("material file not removed", material.storedName, err));
  const lesson = material.lessonId ? await db.lesson.findUnique({ where: { id: material.lessonId }, select: { title: true } }) : null;
  return { ok: true, material, lessonTitle: lesson?.title ?? null };
}
