import { describe, expect, it } from "vitest";
import { AUDIT_KINDS, AUDIT_LABELS } from "@/lib/admin/audit-query";
import { auditChanges, auditObject, emptyNames, type AuditRow } from "@/lib/admin/audit-view";
import { materialsCheck } from "@/lib/admin/integrity";
import { markdownToText } from "../prisma/seed-materials";

const row = (r: Partial<AuditRow>): AuditRow => ({ action: "", actorId: null, actor: "teacher", entity: null, entityId: null, before: null, after: null, ...r });

describe("materials in the audit journal", () => {
  it("names the material and its details in Russian, also after it is deleted", () => {
    const upload = row({
      action: "material.upload",
      entity: "Material",
      entityId: "m1",
      after: { title: "Памятка ДДС", file: "Памятка.pdf", type: "PDF", size: "1,2 МБ", access: "ученикам занятия", lesson: "Пожары" },
    });
    expect(AUDIT_LABELS["material.upload"]).toBe("Загружен материал");
    expect(AUDIT_LABELS["material.delete"]).toBe("Удалён материал");
    expect(AUDIT_KINDS.map((k) => k.value)).toContain("material");
    expect(auditObject(upload, emptyNames())).toBe("Материал «Памятка ДДС»");
    expect(auditChanges(upload, emptyNames())).toEqual(
      expect.arrayContaining([
        { field: "Файл", after: "Памятка.pdf" },
        { field: "Тип файла", after: "PDF" },
        { field: "Размер", after: "1,2 МБ" },
        { field: "Кому виден", after: "ученикам занятия" },
        { field: "Занятие", after: "Пожары" },
      ]),
    );
    const deleted = row({ action: "material.delete", entity: "Material", entityId: "m1", before: { title: "Памятка ДДС", file: "Памятка.pdf" } });
    expect(auditObject(deleted, emptyNames())).toBe("Материал «Памятка ДДС»");
  });

  it("says that a scenario came from a ticket file", () => {
    const generated = row({ action: "scenario.generate", entity: "Scenario", entityId: "s1", after: { via: "file", file: "Билеты.docx", ticket: "Билет 1, ситуация 2" } });
    expect(auditChanges(generated, emptyNames())).toEqual(
      expect.arrayContaining([
        { field: "Способ", after: "из файла билета" },
        { field: "Билет", after: "Билет 1, ситуация 2" },
      ]),
    );
  });
});

describe("integrity: files of the materials", () => {
  const file = (title: string, sizeBytes: number, actual: number | null, mirrored = true) => ({ title, sizeBytes, actual, mirrored });

  it("is fine with an empty library and with every file in place", () => {
    expect(materialsCheck([])).toMatchObject({ code: "materials", ok: true });
    const ok = materialsCheck([file("Памятка", 2048, 2048), file("Схема", 1024, 1024, false)]);
    expect(ok.ok).toBe(true);
    expect(ok.detail).toMatch(/2 файлов, 3 КБ; в каталоге копий — 1 из 2 \(новые попадут в следующую копию\)/);
  });

  it("names the materials whose file is gone or changed", () => {
    const bad = materialsCheck([file("Памятка", 10, null), file("Схема", 10, 7), file("Таблица", 5, 5)]);
    expect(bad.ok).toBe(false);
    expect(bad.detail).toMatch(/Нет файла у 1 из 3: «Памятка» — восстановите из резервной копии/);
    expect(bad.detail).toMatch(/размер файла не совпадает у 1: «Схема»/);
  });
});

describe("demo materials from the repository's guides", () => {
  it("turn Markdown into text a trainee reads: no markup, no pictures, tables as lines", () => {
    const md = "# Рабочее место\n\nЛента **карточек**, см. [инструкцию](op112.md) и `/dds`.\n\n![Снимок](img/1.png)\n\n| Статус | Когда |\n|---|---|\n| Принята | сразу |\n\n- первое\n- второе\n\n## 1. Как открыть\n";
    expect(markdownToText(md)).toBe(
      "РАБОЧЕЕ МЕСТО\n=============\n\nЛента карточек, см. инструкцию и /dds.\n\nСтатус — Когда\nПринята — сразу\n\n• первое\n• второе\n\n1. Как открыть\n--------------\n",
    );
  });
});
