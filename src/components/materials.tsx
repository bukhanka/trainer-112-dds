/** A material in a list of the teacher's, the administrator's or the student's cabinet: what it is and how to get it. */
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui";
import type { MaterialKind } from "@/lib/files/detect";
import { formatDate } from "@/lib/format";
import type { MaterialItem } from "@/lib/materials/service";

const KIND_STYLE: Record<MaterialKind, { text: string; cls: string }> = {
  pdf: { text: "PDF", cls: "bg-red-50 text-red-700 border-red-200" },
  docx: { text: "DOCX", cls: "bg-blue-50 text-blue-700 border-blue-200" },
  xlsx: { text: "XLSX", cls: "bg-emerald-50 text-emerald-800 border-emerald-200" },
  pptx: { text: "PPTX", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  txt: { text: "TXT", cls: "bg-arm-panel text-arm-dark border-arm-gray" },
  png: { text: "PNG", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  jpg: { text: "JPG", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  gif: { text: "GIF", cls: "bg-violet-50 text-violet-700 border-violet-200" },
  webp: { text: "WEBP", cls: "bg-violet-50 text-violet-700 border-violet-200" },
};

export function MaterialCard({ m, children }: { m: MaterialItem; children?: ReactNode }) {
  const style = KIND_STYLE[m.kind];
  return (
    <li className="flex flex-wrap items-center gap-3 rounded border border-arm-gray/70 bg-white p-3 text-sm">
      <span className={`inline-flex h-10 w-12 shrink-0 items-center justify-center rounded border text-xs font-bold ${style.cls}`} title={m.kindLabel}>
        {style.text}
      </span>
      {/* The text keeps at least 14rem: on a phone the buttons move under it instead of squeezing it. */}
      <div className="min-w-0 flex-[1_1_14rem]">
        <div className="break-words font-medium">{m.title}</div>
        <div className="break-words text-xs text-arm-desc">
          {m.fileName} · {m.size} · {m.ownerName}
          {m.mine && " (вы)"}, {formatDate(m.createdAt)}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {m.opens && (
          <a href={`/api/materials/${m.id}`} target="_blank" rel="noopener" className={buttonClass("secondary", "sm")}>
            Открыть
          </a>
        )}
        <a href={`/api/materials/${m.id}?download=1`} className={buttonClass(m.opens ? "ghost" : "secondary", "sm")}>
          Скачать
        </a>
        {children}
      </div>
    </li>
  );
}

export function MaterialList({ items, action }: { items: MaterialItem[]; action?: (m: MaterialItem) => ReactNode }) {
  return (
    <ul className="flex flex-col gap-2">
      {items.map((m) => (
        <MaterialCard key={m.id} m={m}>
          {action?.(m)}
        </MaterialCard>
      ))}
    </ul>
  );
}

export type LessonGroup = { key: string; lesson: MaterialItem["lesson"]; items: MaterialItem[] };

/** Lesson materials by lesson, in the order of their newest material; a deleted lesson makes its own group. */
export function byLesson(items: MaterialItem[]): LessonGroup[] {
  const groups = new Map<string, LessonGroup>();
  for (const m of items) {
    if (m.audience !== "lesson") continue;
    const key = m.lesson?.id ?? "gone";
    const g = groups.get(key) ?? { key, lesson: m.lesson, items: [] };
    g.items.push(m);
    groups.set(key, g);
  }
  return [...groups.values()];
}
