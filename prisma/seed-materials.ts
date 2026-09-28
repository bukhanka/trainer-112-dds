/**
 * Demo materials of the library (src/lib/materials): three files of this repository, each of another kind and for
 * another audience — the trainee's guide to the ДДС place as plain text for every student, a screen of the card at
 * the ДДС place for the students of the draft demo lesson, and the technical documentation in PDF for teachers only.
 * Called by prisma/seed-demo.ts; the files are read from docs/ (copied into the Docker image).
 *
 * Idempotent: fixed ids, a file is written again only when its content changed or it is missing on disk.
 * The nightly demo reset removes what reviewers uploaded (removeUploadedMaterials) and keeps these.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { detectMaterial } from "../src/lib/files/detect";
import { removeMaterialFile, saveMaterialFile, storedPath } from "../src/lib/materials/storage";

type Demo = { id: string; title: string; from: string; fileName: string; audience: "all" | "lesson" | "staff"; lessonId?: string; toText?: boolean };

const DEMO: Demo[] = [
  { id: "demo-material-dds-guide", title: "Памятка: рабочее место диспетчера ДДС", from: "docs/dds.md", fileName: "Место диспетчера ДДС.txt", audience: "all", toText: true },
  {
    id: "demo-material-dds-card",
    title: "Карточка происшествия на месте ДДС — снимок экрана",
    from: "docs/img/02-dds-card.png",
    fileName: "Карточка на месте ДДС.png",
    audience: "lesson",
    lessonId: "demo-lesson-3",
  },
  { id: "demo-material-docs", title: "Техническая документация тренажёра", from: "docs/documentation.pdf", fileName: "Документация тренажёра.pdf", audience: "staff" },
];

/** Markdown of the repository's guides as text a trainee reads in the browser: no markup, tables as lines. */
export function markdownToText(md: string): string {
  return md
    .split("\n")
    .filter((line) => !/^\s*!\[[^\]]*\]\([^)]*\)\s*$/.test(line) && !/^\s*\|?\s*:?-{3,}/.test(line))
    .map((line) => {
      const heading = /^(#{1,6})\s+(.*)$/.exec(line);
      const text = (heading ? heading[2] : line)
        .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/^\s*[-*]\s+/, "• ");
      if (heading) {
        const top = heading[1].length === 1;
        const title = top ? text.toUpperCase() : text;
        return `\n${title}\n${(top ? "=" : "-").repeat(Math.min(60, title.length))}`;
      }
      if (/^\s*\|.*\|\s*$/.test(text)) return text.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()).join(" — ");
      return text;
    })
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .concat("\n");
}

export async function seedDemoMaterials(db: PrismaClient, root = process.cwd()): Promise<number> {
  const owner = await db.user.findUnique({ where: { login: "teacher" }, select: { id: true, fullName: true } });
  let count = 0;
  for (const d of DEMO) {
    const source = path.join(root, d.from);
    if (!existsSync(source)) {
      console.warn(`seed-materials: ${d.from} not found, «${d.title}» skipped`);
      continue;
    }
    const raw = readFileSync(source);
    const bytes = d.toText ? Buffer.from(markdownToText(raw.toString("utf8")), "utf8") : raw;
    const type = detectMaterial(d.fileName, bytes);
    if (!type.ok) throw new Error(`seed-materials: ${d.from}: ${type.error}`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    const existing = await db.material.findUnique({ where: { id: d.id } });
    let storedName = existing?.storedName ?? null;
    if (!existing || existing.sha256 !== sha256 || !existsSync(storedPath(existing.storedName))) {
      storedName = await saveMaterialFile(bytes, type.ext);
      if (existing) await removeMaterialFile(existing.storedName).catch(() => undefined);
    }
    const data = {
      title: d.title,
      fileName: d.fileName,
      storedName: storedName!,
      kind: type.kind,
      mime: type.mime,
      sizeBytes: bytes.length,
      sha256,
      audience: d.audience,
      lessonId: d.lessonId ?? null,
      ownerId: owner?.id ?? null,
      ownerName: owner?.fullName ?? "Преподаватель",
      source: "demo",
    };
    await db.material.upsert({ where: { id: d.id }, update: data, create: { id: d.id, ...data } });
    count++;
  }
  return count;
}

/** Nightly demo reset: every material a reviewer uploaded goes, with its file; the demo set stays. */
export async function removeUploadedMaterials(db: PrismaClient): Promise<number> {
  const rows = await db.material.findMany({ where: { NOT: { source: "demo" } }, select: { id: true, storedName: true } });
  if (!rows.length) return 0;
  await db.material.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } });
  for (const r of rows) await removeMaterialFile(r.storedName).catch(() => undefined);
  return rows.length;
}
