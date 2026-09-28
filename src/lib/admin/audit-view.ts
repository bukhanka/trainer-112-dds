/**
 * The audit journal in plain Russian for the administrator's page and CSV: the object of an entry named as
 * people know it (занятие «Название», попытка ученика, карточка № N, служба, пользователь) instead of an
 * internal id, and its changes as «поле: было → стало» with Russian field names, Russian values and Moscow
 * time instead of raw JSON.
 */
import type { Prisma } from "@prisma/client";
import { SERVICE_LABELS, type ServiceKey } from "./services";
import { SETTING_FIELDS } from "./settings-fields";
import { POLICY_FIELDS, policySettingKey } from "../auth/policy";
import { STATUS_LABEL } from "../dds/status";
import { formatDateTime } from "../format";
import { WEIGHT_GROUPS } from "../scoring/score";
import { SECTIONS } from "../scenarios/sections";

type Json = Prisma.JsonValue;
export type AuditRow = { action: string; actorId: string | null; actor: string | null; entity: string | null; entityId: string | null; before: Json | null; after: Json | null };

/** Names of what journal entries point at, loaded once per page (see loadAuditNames). */
export type AuditNames = {
  lessons: Map<string, string>;
  attempts: Map<string, string>;
  incidents: Map<string, number>;
  plates: Map<string, string>;
  scenarios: Map<string, string>;
  groups: Map<string, string>;
  users: Map<string, { login: string; fullName: string }>;
  services: Map<number, string>;
  corrections: Map<string, string>;
  profiles: Map<string, string>;
  backups: Map<string, string>;
};

export const emptyNames = (): AuditNames => ({
  lessons: new Map(),
  attempts: new Map(),
  incidents: new Map(),
  plates: new Map(),
  scenarios: new Map(),
  groups: new Map(),
  users: new Map(),
  services: new Map(),
  corrections: new Map(),
  profiles: new Map(),
  backups: new Map(),
});

const obj = (v: Json | null | undefined): Record<string, Json> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : {});
const str = (v: Json | undefined): string | null => (typeof v === "string" ? v : null);
const quoted = (v: string) => `«${v}»`;

const SETTING_LABELS: Record<string, string> = {
  ...Object.fromEntries(SETTING_FIELDS.map((f) => [f.key, f.label])),
  ...Object.fromEntries(POLICY_FIELDS.map((f) => [policySettingKey(f.key), `${f.label}, ${f.unit}`])),
  "demo.resetAt": "Время ночного сброса демо-стенда",
};

const personName = (names: AuditNames, id: string | null | undefined) => {
  const u = id ? names.users.get(id) : undefined;
  return u ? `${u.fullName} (${u.login})` : null;
};

// ─── the object ──────────────────────────────────────────────────────────────

/** «Занятие «Пожары»», «Карточка № 36815535 · служба «ЕДДС …»», «Пользователь Иванов И. И. (student1)». */
export function auditObject(row: AuditRow, names: AuditNames): string {
  const id = row.entityId ?? "";
  const a = obj(row.after);
  const b = obj(row.before);
  const titleFromData = str(a.title) ?? str(b.title);
  switch (row.entity) {
    case "Lesson": {
      const title = names.lessons.get(id) ?? titleFromData;
      return title ? `Занятие ${quoted(title)}` : "Занятие (удалено)";
    }
    case "Attempt":
      return names.attempts.get(id) ?? "Попытка (удалена)";
    case "Incident": {
      const n = names.incidents.get(id);
      return n != null ? `Карточка № ${n}` : "Карточка (удалена)";
    }
    case "IncidentService":
      return names.plates.get(id) ?? "Служба на карточке (удалена)";
    case "Scenario": {
      const title = names.scenarios.get(id) ?? titleFromData;
      return title ? `Сценарий ${quoted(title)}` : "Сценарий (удалён)";
    }
    case "Group": {
      const name = names.groups.get(id) ?? str(a.name) ?? str(a.group) ?? str(b.name) ?? str(b.group);
      return name ? `Группа ${quoted(name)}` : "Группа (удалена)";
    }
    case "User": {
      const person = personName(names, id) ?? (str(a.login) ? `${str(a.fullName) ?? ""} (${str(a.login)})`.trim() : null);
      return person ? `Пользователь ${person}` : "Пользователь (удалён)";
    }
    case "TeacherCorrection": {
      const title = names.corrections.get(id);
      return title ? `Правка проверки ${quoted(title)}` : "Правка ИИ-проверки";
    }
    case "WeightProfile":
      return `Веса оценки ${quoted(names.profiles.get(id) ?? "по умолчанию")}`;
    case "SystemSetting":
      return `Настройка ${quoted(SETTING_LABELS[id] ?? id)}`;
    case "Backup":
      return names.backups.get(id) ? `Резервная копия ${names.backups.get(id)}` : "Резервная копия";
    case "Service":
      return `Служба ${quoted(id in SERVICE_LABELS ? SERVICE_LABELS[id as ServiceKey] : id)}`;
    case "Integrity":
      return `Контроль целостности, ${id === "manual" ? "вручную" : "по расписанию"}`;
    case "process":
      return `Процесс сервера № ${id}`;
    case "route":
      return `Запрос ${id}`;
    default:
      return row.entity ? `${row.entity} ${id}`.trim() : "—";
  }
}

/** Who did it: «Смирнова Анна Викторовна (teacher)», «система», or the login typed at a failed login. */
export function auditActor(row: AuditRow, names: AuditNames): string {
  if (row.actor === "system") return "система";
  return personName(names, row.actorId) ?? row.actor ?? "—";
}

// ─── the changes ─────────────────────────────────────────────────────────────

export type AuditChange = { field: string; before?: string; after?: string };

const FIELD: Record<string, string> = {
  status: "Статус",
  reviewStatus: "Проверка",
  startedAt: "Начало",
  finishedAt: "Окончание",
  title: "Название",
  name: "Название",
  groupId: "Группа",
  group: "Группа",
  teacherId: "Преподаватель",
  archivedAt: "В архиве с",
  isBlocked: "Заблокирован",
  login: "Логин",
  fullName: "ФИО",
  role: "Роль",
  crewNumber: "Номер наряда",
  comment: "Комментарий",
  late: "С опозданием",
  score: "Балл",
  teacherComment: "Комментарий преподавателя",
  reviewedBy: "Проверил",
  corrections: "Правки для ИИ-проверок",
  attempts: "Попыток пересчитано",
  rescored: "Балл изменился у попыток",
  active: "Правка действует",
  draftOk: "Черновик сказал",
  teacherOk: "Решение преподавателя",
  reason: "Причина",
  approvedSections: "Утверждённые разделы",
  sections: "Затронутые разделы",
  section: "Раздел",
  generated: "Переписано моделью",
  model: "Модель",
  source: "Черновик составили",
  via: "Способ",
  category: "Категория",
  location: "Район",
  difficulty: "Сложность",
  finalType: "Тип происшествия",
  services: "Служб на карточке",
  usedModel: "С помощью модели",
  kind: "Что выгружено",
  rows: "Строк",
  from: "Повтор занятия",
  linkedTo: "Связана с карточкой №",
  entry: "Дополнение",
  on: "Работает",
  until: "Запустится само",
  by: "Кто остановил",
  at: "Когда остановлено",
  failed: "Неудачных попыток подряд",
  trigger: "Запуск",
  checks: "Проверок",
  message: "Сообщение",
  node: "Версия Node.js",
  scheduler: "С планировщиком",
  demo: "Демо-стенд",
  seats: "Мест",
  forecasts: "Прогнозов на старте",
  draftSeatsRemoved: "Убрано из черновиков занятий",
  serviceId: "Служба",
  lessons: "Удалено занятий",
  scenarios: "Удалено сценариев",
  groups: "Удалено групп",
  users: "Удалено пользователей",
  switches: "Сброшено переключателей и политик",
  policies: "Политики доступа сброшены",
  journal: "Удалено записей журнала",
  backupFiles: "Удалено файлов копий",
  backupRows: "Удалено записей о копиях",
  counters: "Удалено счётчиков статистики",
  sessions: "Удалено истёкших сессий",
  keepDays: "Копии хранятся, дн.",
  retentionDays: "Журнал хранится, дн.",
  changes: "Исправлены проверки",
  settings: "Настройки",
  teacherNote: "Заметка преподавателя",
  callsEnded: "Разговоров на местах 112 завершено",
  callsMissed: "Вызовов на местах 112 пропущено",
};

/** Keys that repeat what the object already says, or ids that mean nothing to a person. */
const HIDDEN = new Set(["override", "attemptId", "profileId", "studentId", "code", "service", "value"]);

const LESSON_SETTINGS: Record<string, string> = {
  categories: "Категории сценариев",
  location: "Район происшествий",
  cardSource: "Откуда карточки",
  tempoSec: "Новая карточка каждые, с",
  maxQueue: "Карточек в очереди места",
  ackSec: "Открыть карточку, с",
  workSec: "Первая запись — статус и текст, с",
  typingSec: "Таймер набора карточки 112, с",
  passScore: "Порог зачёта, баллов",
  maxCritical: "Допустимо критичных ошибок",
  commentTemplate: "Шаблон итогового комментария",
  hints: "Подсказки",
  brigadeReports: "Доклады бригад",
  practice: "Самостоятельная тренировка",
  adaptive: "Задания по уровню ученика",
  sameCard: "Одна карточка на всех",
};

const STATUS_BY_ENTITY: Record<string, Record<string, string>> = {
  Lesson: { DRAFT: "черновик", RUNNING: "идёт", FINISHED: "завершено" },
  Scenario: { DRAFT: "черновик", APPROVED: "утверждён", ARCHIVED: "в архиве" },
  IncidentService: STATUS_LABEL,
};
const REVIEW: Record<string, string> = { PENDING: "на проверке", CONFIRMED: "подтверждена", OVERRIDDEN: "исправлена преподавателем" };
const ROLE: Record<string, string> = { ADMIN: "администратор", TEACHER: "преподаватель", STUDENT: "обучающийся", OP112: "оператор 112", DDS: "диспетчер ДДС" };
const WORDS: Record<string, Record<string, string>> = {
  reason: { no_user: "нет такого логина", revised: "преподаватель изменил решение по попытке", "demo-reset": "ночной сброс демо-стенда", timeout: "истёк срок остановки на стенде" },
  trigger: { manual: "вручную", scheduled: "по расписанию" },
  kind: { students: "по ученикам", attempts: "по попыткам" },
  source: { ai: "ИИ", rules: "правила" },
  via: { category: "по категории и району" },
  cardSource: { generated: "генерирует система", students: "от учеников на местах 112", mixed: "система и ученики" },
};
const SECTION_TITLES: Record<string, string> = Object.fromEntries(SECTIONS.map((s) => [s.key, s.title]));
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function verdict(v: Json | undefined): string {
  return v === true ? "верно" : v === false ? "ошибка" : "не применимо";
}

/** A value in words: Moscow time, да/нет, Russian statuses and roles, names instead of ids. */
function value(key: string, v: Json | undefined, row: AuditRow, names: AuditNames): string {
  if (v === undefined || v === null || v === "") {
    if (key === "archivedAt") return "нет";
    if (key === "location") return "вся Москва";
    return "—";
  }
  if (key === "draftOk" || key === "teacherOk") return verdict(v);
  if (typeof v === "boolean") return v ? "да" : "нет";
  if (key === "score" && typeof v === "number") return String(Math.round(v));
  if (key === "status") return STATUS_BY_ENTITY[row.entity ?? ""]?.[String(v)] ?? String(v);
  if (key === "reviewStatus") return REVIEW[String(v)] ?? String(v);
  if (key === "role") return ROLE[String(v)] ?? String(v);
  if (key === "groupId") return names.groups.get(String(v)) ?? "группа удалена";
  if (key === "teacherId") return personName(names, String(v)) ?? "—";
  if (key === "serviceId") return names.services.get(Number(v)) ?? `служба ${String(v)}`;
  if (key === "from") return names.lessons.get(String(v)) ? quoted(names.lessons.get(String(v))!) : "занятие удалено";
  if (key === "section") return SECTION_TITLES[String(v)] ?? String(v);
  if (key === "approvedSections" || key === "sections") return Array.isArray(v) && v.length ? v.map((s) => SECTION_TITLES[String(s)] ?? String(s)).join(", ") : "нет";
  if (key === "categories") return Array.isArray(v) && v.length ? v.join(", ") : "все";
  if (key === "corrections") {
    const c = obj(v);
    return `добавлено ${Number(c.created ?? 0)}, снято ${Number(c.retired ?? 0)}`;
  }
  if (key === "location" && typeof v === "object") {
    const l = obj(v);
    return [str(l.okrug), str(l.district)].filter(Boolean).join(", ") || "вся Москва";
  }
  if (WORDS[key] && typeof v === "string") return WORDS[key][v] ?? v;
  if (typeof v === "string") return ISO_TIME.test(v) ? formatDateTime(v, true) : v;
  if (typeof v === "number") return String(v);
  if (Array.isArray(v)) return v.every((x) => typeof x !== "object") ? v.join(", ") : `${v.length} шт.`;
  return "изменено";
}

const same = (a: Json | undefined, b: Json | undefined) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** «поле: было → стало» for the keys of two flat objects; keys only on one side are shown as a plain value. */
function pairs(before: Record<string, Json>, after: Record<string, Json>, row: AuditRow, names: AuditNames, label: (k: string) => string, hide: Set<string> = HIDDEN): AuditChange[] {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !hide.has(k));
  const out: AuditChange[] = [];
  for (const k of keys) {
    const inB = k in before;
    const inA = k in after;
    if (inB && inA && same(before[k], after[k])) continue;
    out.push({
      field: label(k),
      ...(inB ? { before: value(k, before[k], row, names) } : {}),
      ...(inA ? { after: value(k, after[k], row, names) } : {}),
    });
  }
  return out;
}

type Seat = { student?: string; role?: string; service?: number | null; tasks?: string[] };

function seatText(s: Seat, names: AuditNames): string {
  const where = s.role === "OP112" ? "место 112" : `ДДС ${quoted(names.services.get(Number(s.service)) ?? "служба")}`;
  return `${where}${s.tasks?.length ? `, заданий ${s.tasks.length}` : ""}`;
}

/** A lesson snapshot (src/lib/lessons/save.ts): title, group, settings one by one, places by student. */
function lessonChanges(row: AuditRow, names: AuditNames): AuditChange[] {
  const b = obj(row.before);
  const a = obj(row.after);
  const out = pairs(
    Object.fromEntries(Object.entries(b).filter(([k]) => k !== "settings" && k !== "seats")),
    Object.fromEntries(Object.entries(a).filter(([k]) => k !== "settings" && k !== "seats")),
    row,
    names,
    (k) => FIELD[k] ?? k,
  );
  const sb = obj(b.settings);
  const sa = obj(a.settings);
  out.push(...pairs(sb, sa, row, names, (k) => LESSON_SETTINGS[k] ?? k, new Set()).filter((c) => !(row.action === "lesson.create" && c.after === "—")));
  const seatsB = (Array.isArray(b.seats) ? b.seats : []) as Seat[];
  const seatsA = (Array.isArray(a.seats) ? a.seats : []) as Seat[];
  if ("seats" in b || "seats" in a) {
    const byStudent = (list: Seat[]) => new Map(list.map((s) => [String(s.student), s]));
    const mb = byStudent(seatsB);
    const ma = byStudent(seatsA);
    for (const id of new Set([...mb.keys(), ...ma.keys()])) {
      const sb1 = mb.get(id);
      const sa1 = ma.get(id);
      if (sb1 && sa1 && same(sb1 as Json, sa1 as Json)) continue;
      out.push({
        field: `Место: ${personName(names, id) ?? "ученик удалён"}`,
        ...(sb1 ? { before: seatText(sb1, names) } : {}),
        ...(sa1 ? { after: seatText(sa1, names) } : {}),
      });
    }
  }
  return out;
}

/** Changes of a journal entry in words; an empty list when there is nothing to show. */
export function auditChanges(row: AuditRow, names: AuditNames): AuditChange[] {
  const b = obj(row.before);
  const a = obj(row.after);
  switch (row.action) {
    case "lesson.create":
    case "lesson.update":
    case "lesson.delete":
      return lessonChanges(row, names);
    case "setting.update": {
      const v = (x: Json | null) => (x == null ? "—" : String(x));
      return [{ field: SETTING_LABELS[row.entityId ?? ""] ?? row.entityId ?? "Значение", before: v(row.before), after: v(row.after) }];
    }
    case "weights.update": {
      const out = pairs(obj(b.weights), obj(a.weights), row, names, (k) => `Вес: ${(WEIGHT_GROUPS as Record<string, string>)[k] ?? k}`, new Set());
      if (a.attempts != null) out.push({ field: "Пересчитано попыток", after: `${Number(a.attempts)}, балл изменился у ${Number(a.rescored ?? 0)}` });
      return out;
    }
    case "group.member.add":
    case "group.member.remove": {
      const who = row.action === "group.member.add" ? a : b;
      const out: AuditChange[] = [{ field: "Ученик", after: `${str(who.fullName) ?? ""} (${str(who.student) ?? ""})`.trim() }];
      if (a.draftSeatsRemoved) out.push({ field: FIELD.draftSeatsRemoved, after: String(a.draftSeatsRemoved) });
      return out;
    }
    case "attempt.confirm":
    case "attempt.override":
    case "attempt.reopen": {
      // The verdict first, then the score and the comment; who reviewed is the «Кто» of the entry.
      const pick = (o: Record<string, Json>) => Object.fromEntries(["reviewStatus", "score", "teacherComment"].filter((k) => k in o).map((k) => [k, o[k]]));
      const out = pairs(pick(b), pick(a), row, names, (k) => FIELD[k] ?? k);
      for (const c of Array.isArray(a.changes) ? a.changes : []) {
        const ch = obj(c);
        out.push({ field: `Проверка ${quoted(str(ch.title) ?? str(ch.code) ?? "")}`, before: verdict(ch.from), after: verdict(ch.to) });
      }
      const cor = obj(a.corrections);
      if (Number(cor.created ?? 0) || Number(cor.retired ?? 0)) out.push({ field: FIELD.corrections, after: value("corrections", a.corrections, row, names) });
      return out;
    }
    case "scenario.update":
    case "scenario.regenerate": {
      const sectionKeys = new Set(Object.keys(SECTION_TITLES));
      const out = pairs(b, a, row, names, (k) => FIELD[k] ?? k, new Set([...HIDDEN, ...sectionKeys]));
      for (const k of sectionKeys) if (k in a) out.unshift({ field: `Раздел ${quoted(SECTION_TITLES[k])}`, after: row.action === "scenario.regenerate" ? "переписан" : "изменён" });
      return out;
    }
    case "service.start":
    case "service.stop":
    case "service.auto_start":
      return pairs(b, a, row, names, (k) => FIELD[k] ?? k, new Set([...HIDDEN, "service"]));
    case "system.integrity.ok":
    case "system.integrity.fail": {
      const out = pairs({}, a, row, names, (k) => FIELD[k] ?? k, new Set([...HIDDEN, "failed"]));
      const failed = Array.isArray(a.failed) ? a.failed.map(String) : [];
      if (failed.length) out.push({ field: "Проблемы", after: failed.join("; ") });
      return out;
    }
    case "demo.defaults": {
      const started = Array.isArray(a.services) ? a.services.map((k) => SERVICE_LABELS[String(k) as ServiceKey] ?? String(k)) : [];
      const out: AuditChange[] = started.length ? [{ field: "Запущены службы", after: started.join(", ") }] : [];
      if (a.policies) out.push({ field: FIELD.policies, after: "да" });
      return out;
    }
    default:
      return pairs(b, a, row, names, (k) => FIELD[k] ?? k);
  }
}

/** One line for the CSV: «Статус: идёт → завершено; Окончание: 27.09.2026, 09:05:56». */
export function changesText(list: AuditChange[]): string {
  return list.map((c) => `${c.field}: ${c.before !== undefined && c.after !== undefined ? `${c.before} → ${c.after}` : (c.after ?? c.before)}`).join("; ");
}

// ─── what to load ────────────────────────────────────────────────────────────

export type NeededIds = {
  lessons: Set<string>;
  attempts: Set<string>;
  incidents: Set<string>;
  plates: Set<string>;
  scenarios: Set<string>;
  groups: Set<string>;
  users: Set<string>;
  services: Set<number>;
  corrections: Set<string>;
  profiles: Set<string>;
  backups: Set<string>;
};

const ENTITY_SET: Record<string, keyof NeededIds> = {
  Lesson: "lessons",
  Attempt: "attempts",
  Incident: "incidents",
  IncidentService: "plates",
  Scenario: "scenarios",
  Group: "groups",
  User: "users",
  TeacherCorrection: "corrections",
  WeightProfile: "profiles",
  Backup: "backups",
};

/** Every id the rows point at — the entity, the actor, and ids inside the data (group, teacher, service, places). */
export function neededIds(rows: AuditRow[]): NeededIds {
  const need: NeededIds = {
    lessons: new Set(),
    attempts: new Set(),
    incidents: new Set(),
    plates: new Set(),
    scenarios: new Set(),
    groups: new Set(),
    users: new Set(),
    services: new Set(),
    corrections: new Set(),
    profiles: new Set(),
    backups: new Set(),
  };
  for (const r of rows) {
    if (r.actorId) need.users.add(r.actorId);
    const set = r.entity ? ENTITY_SET[r.entity] : undefined;
    if (set && r.entityId) (need[set] as Set<string>).add(r.entityId);
    for (const side of [obj(r.before), obj(r.after)]) {
      if (typeof side.groupId === "string") need.groups.add(side.groupId);
      if (typeof side.teacherId === "string") need.users.add(side.teacherId);
      if (typeof side.serviceId === "number") need.services.add(side.serviceId);
      if (r.action === "lesson.copy" && typeof side.from === "string") need.lessons.add(side.from);
      for (const seat of Array.isArray(side.seats) ? side.seats : []) {
        const s = obj(seat);
        if (typeof s.student === "string") need.users.add(s.student);
        if (typeof s.service === "number") need.services.add(s.service);
      }
    }
  }
  return need;
}
