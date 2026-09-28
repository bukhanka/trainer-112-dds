/**
 * Demo data: accounts for every role, one group, default settings and weights.
 * Reference data (classifier, services, scenarios) is loaded by prisma/seed-reference.ts.
 * Idempotent: safe to run again.
 */
import { PrismaClient, type Role } from "@prisma/client";
import bcrypt from "bcryptjs";
import { seedReference } from "./seed-reference";
import { isEntry } from "./entry";

export const DEMO_ACCOUNTS: { login: string; password: string; fullName: string; role: Role }[] = [
  { login: "admin", password: "Admin2026", fullName: "Администратор системы", role: "ADMIN" },
  { login: "teacher", password: "Teacher2026", fullName: "Смирнова Ольга Петровна", role: "TEACHER" },
  { login: "student1", password: "Student2026", fullName: "Иванов Алексей Сергеевич", role: "STUDENT" },
  { login: "student2", password: "Student2026", fullName: "Петрова Мария Игоревна", role: "STUDENT" },
  { login: "student3", password: "Student2026", fullName: "Кузнецов Дмитрий Андреевич", role: "STUDENT" },
  { login: "student4", password: "Student2026", fullName: "Соколова Елена Викторовна", role: "STUDENT" },
  { login: "student5", password: "Student2026", fullName: "Морозов Павел Николаевич", role: "STUDENT" },
];

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  "norm.ackSec": 30, // ДДС: open the card within 30 s of «Добавлена» (the customer's norm)
  "norm.workSec": 180, // ДДС: the first record — status and text — within 3 min of «Добавлена»
  "norm.typingSec": 65, // 112 card typing timer turns red
  "norm.finishHours": 48, // «Не завершено»
  "audit.retentionDays": 190, // security journal ≥ 6 months
  "backup.dailyAt": "03:00",
  "backup.keepDays": 14,
  "demo.resetAt": "04:30", // public demo stand only (DEMO_MODE=true)
  "integrity.dailyAt": "05:00", // after the backup and the demo reset
  "integrity.minFreeGb": 2, // the integrity check fails below this free space
};

export const DEFAULT_WEIGHTS: Record<string, number> = {
  timeliness: 3, // 30 s / 3 min / typing time
  statusOrder: 2, // status chain as in the dispatcher memo
  comments: 2, // mandatory comments, «кому передано»
  address: 3, // address correctness; a look-alike street is critical
  services: 3, // services and incident type
  completeness: 1, // required fields, questions asked
  literacy: 1, // text clear for the next dispatcher
  timeZeroAt: 2, // past the time norm the points fall linearly and reach zero at twice the norm (src/lib/scoring/score.ts)
};

/** Accounts, group, settings, weights, reference data. */
export async function seedBase(db: PrismaClient) {
  for (const a of DEMO_ACCOUNTS) {
    await db.user.upsert({
      where: { login: a.login },
      update: {},
      create: { login: a.login, fullName: a.fullName, role: a.role, passwordHash: await bcrypt.hash(a.password, 10) },
    });
  }

  const teacher = await db.user.findUniqueOrThrow({ where: { login: "teacher" } });
  const students = await db.user.findMany({ where: { role: "STUDENT" } });
  const group = (await db.group.findFirst({ where: { name: "Учебная группа № 1" } })) ??
    (await db.group.create({ data: { name: "Учебная группа № 1", teacherId: teacher.id } }));
  for (const s of students) {
    await db.groupMember.upsert({
      where: { groupId_userId: { groupId: group.id, userId: s.id } },
      update: {},
      create: { groupId: group.id, userId: s.id },
    });
  }

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.systemSetting.upsert({ where: { key }, update: {}, create: { key, value: value as never } });
  }

  if (!(await db.weightProfile.findFirst({ where: { isActive: true } }))) {
    await db.weightProfile.create({ data: { name: "По умолчанию", weights: DEFAULT_WEIGHTS, isActive: true } });
  }

  await seedReference(db);

  console.log(`seed: ${DEMO_ACCOUNTS.length} accounts, group «${group.name}» with ${students.length} students`);
}

if (isEntry("seed")) {
  const client = new PrismaClient();
  seedBase(client)
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(() => client.$disconnect());
}
