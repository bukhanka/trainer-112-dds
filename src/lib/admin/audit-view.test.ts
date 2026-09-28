import { describe, expect, it } from "vitest";
import { auditActor, auditChanges, auditObject, changesText, emptyNames, neededIds, type AuditRow } from "./audit-view";

const row = (r: Partial<AuditRow> & { action: string }): AuditRow => ({ actorId: null, actor: "teacher", entity: null, entityId: null, before: null, after: null, ...r });

const names = emptyNames();
names.lessons.set("l1", "Пожары и газ");
names.users.set("u-teacher", { login: "teacher", fullName: "Смирнова Анна Викторовна" });
names.users.set("u-s1", { login: "student1", fullName: "Иванов Иван Иванович" });
names.users.set("u-s2", { login: "student2", fullName: "Петрова Ольга Сергеевна" });
names.groups.set("g1", "Учебная группа № 1");
names.services.set(7, "ЕДДС Хорошёво-Мнёвники");
names.plates.set("p1", "Карточка № 36815535 · служба «ЕДДС Хорошёво-Мнёвники»");
names.attempts.set("a1", "Попытка: Иванов Иван Иванович · место 112 · карточка № 36815535 · занятие «Пожары и газ»");
names.incidents.set("i1", 36815535);

describe("audit journal in words", () => {
  it("names the object instead of an internal id", () => {
    expect(auditObject(row({ action: "lesson.stop", entity: "Lesson", entityId: "l1" }), names)).toBe("Занятие «Пожары и газ»");
    expect(auditObject(row({ action: "dds.status", entity: "IncidentService", entityId: "p1" }), names)).toBe("Карточка № 36815535 · служба «ЕДДС Хорошёво-Мнёвники»");
    expect(auditObject(row({ action: "attempt.confirm", entity: "Attempt", entityId: "a1" }), names)).toContain("Иванов Иван Иванович");
    expect(auditObject(row({ action: "op112.card.save", entity: "Incident", entityId: "i1" }), names)).toBe("Карточка № 36815535");
    expect(auditObject(row({ action: "user.block", entity: "User", entityId: "u-s1" }), names)).toBe("Пользователь Иванов Иван Иванович (student1)");
    expect(auditObject(row({ action: "setting.update", entity: "SystemSetting", entityId: "policy.sessionHours" }), names)).toBe("Настройка «Срок сессии, ч»");
    expect(auditObject(row({ action: "service.stop", entity: "Service", entityId: "ai" }), names)).toBe("Служба «Модели ИИ»");
    // gone from the database: the name saved in the entry itself, or an honest «удалено»
    expect(auditObject(row({ action: "lesson.delete", entity: "Lesson", entityId: "gone", before: { title: "Старое занятие" } }), names)).toBe("Занятие «Старое занятие»");
    expect(auditObject(row({ action: "attempt.confirm", entity: "Attempt", entityId: "gone" }), names)).toBe("Попытка (удалена)");
  });

  it("shows who in full and the system as «система»", () => {
    expect(auditActor(row({ action: "lesson.stop", actorId: "u-teacher" }), names)).toBe("Смирнова Анна Викторовна (teacher)");
    expect(auditActor(row({ action: "system.start", actor: "system" }), names)).toBe("система");
    expect(auditActor(row({ action: "auth.login.fail", actor: "nosuchuser" }), names)).toBe("nosuchuser");
  });

  it("turns a lesson stop into Russian words and Moscow time", () => {
    const stop = row({
      action: "lesson.stop",
      entity: "Lesson",
      entityId: "l1",
      before: { status: "RUNNING", startedAt: "2026-09-27T06:05:56.000Z" },
      after: { status: "FINISHED", finishedAt: "2026-09-27T06:50:00.000Z" },
    });
    expect(auditChanges(stop, names)).toEqual([
      { field: "Статус", before: "идёт", after: "завершено" },
      { field: "Начало", before: "27.09.2026, 09:05:56" },
      { field: "Окончание", after: "27.09.2026, 09:50:00" },
    ]);
    expect(changesText(auditChanges(stop, names))).toBe("Статус: идёт → завершено; Начало: 27.09.2026, 09:05:56; Окончание: 27.09.2026, 09:50:00");
  });

  it("reads a ДДС status change with the service statuses", () => {
    const status = row({
      action: "dds.status",
      entity: "IncidentService",
      entityId: "p1",
      before: { status: "ADDED", crewNumber: null },
      after: { status: "ACCEPTED", crewNumber: "15", comment: "Принята, направлен наряд", late: false },
    });
    expect(auditChanges(status, names)).toEqual([
      { field: "Статус", before: "Добавлена", after: "Принята" },
      { field: "Номер наряда", before: "—", after: "15" },
      { field: "Комментарий", after: "Принята, направлен наряд" },
      { field: "С опозданием", after: "нет" },
    ]);
  });

  it("lists what the teacher changed in a review, not the raw override", () => {
    const review = row({
      action: "attempt.override",
      entity: "Attempt",
      entityId: "a1",
      before: { reviewStatus: "PENDING", override: null, score: 64.4, teacherComment: null, reviewedBy: null },
      after: {
        reviewStatus: "OVERRIDDEN",
        override: { "op112.ai.said": true },
        score: 72.2,
        teacherComment: "Адрес записан верно",
        reviewedBy: "teacher",
        changes: [{ code: "op112.ai.said", title: "ИИ: всё сказанное попало в карточку", from: false, to: true }],
        corrections: { created: 1, retired: 0 },
      },
    });
    const text = changesText(auditChanges(review, names));
    expect(text).toMatch(/^Проверка: на проверке → исправлена преподавателем; Балл: 64 → 72; Комментарий преподавателя: — → Адрес записан верно/);
    expect(text).toContain("Балл: 64 → 72");
    expect(text).toContain("Проверка «ИИ: всё сказанное попало в карточку»: ошибка → верно");
    expect(text).toContain("Правки для ИИ-проверок: добавлено 1, снято 0");
    expect(text).not.toMatch(/override|op112\.ai/);
  });

  it("compares lesson settings one by one and places by student", () => {
    const update = row({
      action: "lesson.update",
      entity: "Lesson",
      entityId: "l1",
      before: {
        title: "Пожары",
        groupId: "g1",
        status: "DRAFT",
        settings: { tempoSec: 90, hints: false, cardSource: "generated" },
        seats: [{ student: "u-s1", role: "OP112", service: null, tasks: [], label: null }],
      },
      after: {
        title: "Пожары и газ",
        groupId: "g1",
        status: "DRAFT",
        settings: { tempoSec: 60, hints: true, cardSource: "generated" },
        seats: [
          { student: "u-s1", role: "OP112", service: null, tasks: [], label: null },
          { student: "u-s2", role: "DDS", service: 7, tasks: ["sc1", "sc2"], label: null },
        ],
      },
    });
    expect(auditChanges(update, names)).toEqual([
      { field: "Название", before: "Пожары", after: "Пожары и газ" },
      { field: "Новая карточка каждые, с", before: "90", after: "60" },
      { field: "Подсказки", before: "нет", after: "да" },
      { field: "Место: Петрова Ольга Сергеевна (student2)", after: "ДДС «ЕДДС Хорошёво-Мнёвники», заданий 2" },
    ]);
  });

  it("names the setting and its values, the group member, the switched service", () => {
    expect(auditChanges(row({ action: "setting.update", entity: "SystemSetting", entityId: "backup.dailyAt", before: "03:00", after: "02:30" }), names)).toEqual([
      { field: "Время ежедневной резервной копии", before: "03:00", after: "02:30" },
    ]);
    const member = row({ action: "group.member.add", entity: "Group", entityId: "g1", after: { group: "Учебная группа № 1", studentId: "u-s1", student: "student1", fullName: "Иванов Иван Иванович" } });
    expect(auditChanges(member, names)).toEqual([{ field: "Ученик", after: "Иванов Иван Иванович (student1)" }]);
    const stop = row({ action: "service.stop", entity: "Service", entityId: "ai", before: { on: true }, after: { on: false, service: "Модели ИИ", until: "2026-09-27T11:15:00.000Z" } });
    expect(auditChanges(stop, names)).toEqual([
      { field: "Работает", before: "да", after: "нет" },
      { field: "Запустится само", after: "27.09.2026, 14:15:00" },
    ]);
    const group = row({ action: "group.update", entity: "Group", entityId: "g1", before: { name: "Группа 1", teacherId: "u-teacher", archivedAt: null }, after: { name: "Группа 1", teacherId: "u-teacher", archivedAt: "2026-09-27T07:00:00.000Z" } });
    expect(auditChanges(group, names)).toEqual([{ field: "В архиве с", before: "нет", after: "27.09.2026, 10:00:00" }]);
  });

  it("leaves no English keys for the events the code writes", () => {
    const samples = [
      row({ action: "auth.login.fail", after: { reason: "no_user" } }),
      row({ action: "auth.lockout", after: { failed: 5 } }),
      row({ action: "lesson.start", entity: "Lesson", entityId: "l1", before: { status: "DRAFT" }, after: { status: "RUNNING", startedAt: "2026-09-27T06:05:56.000Z", seats: 3, forecasts: 3 } }),
      row({ action: "lesson.copy", entity: "Lesson", entityId: "l2", after: { from: "l1", title: "Пожары и газ" } }),
      row({ action: "report.export", entity: "Lesson", entityId: "l1", after: { kind: "attempts", rows: 12 } }),
      row({ action: "op112.card.link", entity: "Incident", entityId: "i1", after: { linkedTo: 36815530 } }),
      row({ action: "dds.practice.start", entity: "Lesson", entityId: "l1", after: { serviceId: 7 } }),
      row({ action: "correction.add", entity: "TeacherCorrection", entityId: "c1", after: { attemptId: "a1", code: "dds.ai.literacy", draftOk: false, teacherOk: true, comment: "Понятно" } }),
      row({ action: "correction.revise", entity: "TeacherCorrection", entityId: "c1", before: { active: true }, after: { active: false, reason: "revised" } }),
      row({ action: "scenario.approve", entity: "Scenario", entityId: "s1", before: { status: "DRAFT", approvedSections: [] }, after: { status: "APPROVED", approvedSections: ["caller", "truth"], sections: ["caller", "truth"] } }),
      row({ action: "scenario.regenerate", entity: "Scenario", entityId: "s1", before: { caller: {}, status: "DRAFT" }, after: { caller: { a: 1 }, status: "DRAFT", comment: "Короче", model: "local" } }),
      row({ action: "scenario.generate", entity: "Scenario", entityId: "s1", after: { via: "category", category: "пожар", location: "СЗАО", difficulty: 3, finalType: "Пожар", services: 3, usedModel: true } }),
      row({ action: "weights.update", entity: "WeightProfile", entityId: "w1", before: { profileId: "w1", weights: { address: 3, timeZeroAt: 2 } }, after: { weights: { address: 4, timeZeroAt: 2.5 }, attempts: 72, rescored: 10 } }),
      row({ action: "attempt.draft", entity: "Attempt", entityId: "a1", after: { source: "ai", model: "local" } }),
      row({ action: "system.integrity.fail", actor: "system", entity: "Integrity", entityId: "scheduled", after: { trigger: "scheduled", checks: 5, failed: ["Диск: мало места"] } }),
      row({ action: "system.cleanup", actor: "system", after: { backupFiles: 1, backupRows: 1, journal: 0, sessions: 3, counters: 0, keepDays: 14, retentionDays: 190 } }),
      row({ action: "demo.reset", actor: "system", after: { lessons: 3, scenarios: 1, groups: 0, users: 2, switches: 1 } }),
    ];
    for (const s of samples) {
      const text = changesText(auditChanges(s, names));
      expect(text, s.action).toBeTruthy();
      expect(text, `${s.action}: ${text}`).not.toMatch(/(^|; )[a-zA-Z]+:/);
    }
    expect(changesText(auditChanges(samples[3], names))).toContain("Повтор занятия: «Пожары и газ»");
    expect(changesText(auditChanges(samples[6], names))).toBe("Служба: ЕДДС Хорошёво-Мнёвники");
  });

  it("collects the ids to look up: entity, actor, group, teacher, services and places", () => {
    const need = neededIds([
      row({ action: "lesson.update", actorId: "u-teacher", entity: "Lesson", entityId: "l1", before: { groupId: "g1", seats: [{ student: "u-s1", service: 7 }] }, after: {} }),
      row({ action: "lesson.copy", entity: "Lesson", entityId: "l2", after: { from: "l1" } }),
    ]);
    expect([...need.lessons].sort()).toEqual(["l1", "l2"]);
    expect([...need.users].sort()).toEqual(["u-s1", "u-teacher"]);
    expect([...need.groups]).toEqual(["g1"]);
    expect([...need.services]).toEqual([7]);
  });
});
