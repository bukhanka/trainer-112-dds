/**
 * Loads the names the audit journal shows instead of internal ids (src/lib/admin/audit-view.ts): one query
 * per kind of object for a whole page or CSV, in chunks so that a long export stays within query limits.
 */
import { db } from "../db";
import { emptyNames, neededIds, type AuditNames, type AuditRow } from "./audit-view";

const CHUNK = 5000;

async function inChunks<T>(ids: Set<T>, load: (part: T[]) => Promise<void>): Promise<void> {
  const list = [...ids];
  for (let i = 0; i < list.length; i += CHUNK) await load(list.slice(i, i + CHUNK));
}

export async function loadAuditNames(rows: AuditRow[]): Promise<AuditNames> {
  const need = neededIds(rows);
  const names = emptyNames();
  await Promise.all([
    inChunks(need.lessons, async (ids) => {
      for (const r of await db.lesson.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } })) names.lessons.set(r.id, r.title);
    }),
    inChunks(need.attempts, async (ids) => {
      const rows = await db.attempt.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          kind: true,
          student: { select: { fullName: true } },
          incident: { select: { number: true } },
          incidentService: { select: { incident: { select: { number: true } }, service: { select: { shortName: true } } } },
          lesson: { select: { title: true } },
        },
      });
      for (const a of rows) {
        const card = a.incident?.number ?? a.incidentService?.incident.number;
        const parts = [
          `Попытка: ${a.student.fullName}`,
          a.kind === "OP112" ? "место 112" : `место ДДС${a.incidentService ? ` «${a.incidentService.service.shortName}»` : ""}`,
          card != null ? `карточка № ${card}` : null,
          `занятие «${a.lesson.title}»`,
        ];
        names.attempts.set(a.id, parts.filter(Boolean).join(" · "));
      }
    }),
    inChunks(need.incidents, async (ids) => {
      for (const r of await db.incident.findMany({ where: { id: { in: ids } }, select: { id: true, number: true } })) names.incidents.set(r.id, r.number);
    }),
    inChunks(need.plates, async (ids) => {
      const rows = await db.incidentService.findMany({ where: { id: { in: ids } }, select: { id: true, incident: { select: { number: true } }, service: { select: { shortName: true } } } });
      for (const r of rows) names.plates.set(r.id, `Карточка № ${r.incident.number} · служба «${r.service.shortName}»`);
    }),
    inChunks(need.scenarios, async (ids) => {
      for (const r of await db.scenario.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } })) names.scenarios.set(r.id, r.title);
    }),
    inChunks(need.groups, async (ids) => {
      for (const r of await db.group.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) names.groups.set(r.id, r.name);
    }),
    inChunks(need.users, async (ids) => {
      for (const r of await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, login: true, fullName: true } })) names.users.set(r.id, { login: r.login, fullName: r.fullName });
    }),
    inChunks(need.services, async (ids) => {
      for (const r of await db.service.findMany({ where: { id: { in: ids } }, select: { id: true, shortName: true } })) names.services.set(r.id, r.shortName);
    }),
    inChunks(need.corrections, async (ids) => {
      for (const r of await db.teacherCorrection.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } })) names.corrections.set(r.id, r.title);
    }),
    inChunks(need.profiles, async (ids) => {
      for (const r of await db.weightProfile.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })) names.profiles.set(r.id, r.name);
    }),
    inChunks(need.backups, async (ids) => {
      for (const r of await db.backup.findMany({ where: { id: { in: ids } }, select: { id: true, fileName: true } })) if (r.fileName) names.backups.set(r.id, r.fileName);
    }),
  ]);
  return names;
}
