/**
 * Nightly reset of the public demo stand (DEMO_MODE=true): whatever reviewers created or changed during
 * the day is removed, and the stand returns to its initial state — demo accounts, reference data,
 * ticket scenarios as delivered, default weights and norms, demo lessons and demo materials (uploads go); every service stopped by an
 * administrator runs again and the access policy returns to its defaults (.env).
 *
 *   node dist/demo-reset.js                 (in the Docker image; the scheduler runs it daily)
 *   pnpm exec tsx prisma/demo-reset.ts      (development)
 */
import { PrismaClient } from "@prisma/client";
import { DEFAULT_SETTINGS, DEFAULT_WEIGHTS, DEMO_ACCOUNTS, seedBase } from "./seed";
import { disconnectDemo, seedDemo } from "./seed-demo";
import { removeUploadedMaterials } from "./seed-materials";
import { isEntry } from "./entry";

const DEMO_GROUP = "Учебная группа № 1";

export async function resetDemo(db: PrismaClient) {
  const demoLogins = DEMO_ACCOUNTS.map((a) => a.login);

  // Lessons cascade to places, cards, calls and attempts; cards outside a lesson go separately.
  const lessons = await db.lesson.deleteMany({});
  await db.incident.deleteMany({ where: { lessonId: null } });
  const scenarios = await db.scenario.deleteMany({ where: { NOT: { source: { in: ["ticket", "instruction"] } } } });
  const groups = await db.group.deleteMany({ where: { NOT: { name: DEMO_GROUP } } });
  const users = await db.user.deleteMany({ where: { login: { notIn: demoLogins } } });
  // Reviewers' uploads go with their files; the demo materials are rebuilt by seedDemo below.
  const materials = await removeUploadedMaterials(db);
  await db.user.updateMany({
    where: { login: { in: demoLogins } },
    data: { isBlocked: false, failedLogins: 0, lockedUntil: null },
  });

  await db.weightProfile.deleteMany({});
  await db.weightProfile.create({ data: { name: "По умолчанию", weights: DEFAULT_WEIGHTS, isActive: true } });
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await db.systemSetting.upsert({ where: { key }, update: { value: value as never }, create: { key, value: value as never } });
  }
  // No switch row — the service runs; no policy row — the .env default applies (src/lib/admin/services.ts, src/lib/auth/policy.ts).
  const switches = await db.systemSetting.deleteMany({ where: { OR: [{ key: { startsWith: "service." } }, { key: { startsWith: "policy." } }] } });

  // Accounts, group membership, reference data; ticket scenarios are restored to the delivered text.
  await seedBase(db);
  await seedDemo();

  await db.auditLog.create({
    data: {
      action: "demo.reset",
      actor: "system",
      after: { lessons: lessons.count, scenarios: scenarios.count, groups: groups.count, users: users.count, materials, switches: switches.count },
    },
  });
  console.log(`demo-reset: removed ${lessons.count} lessons, ${scenarios.count} scenarios, ${groups.count} groups, ${users.count} users, ${materials} materials; demo rebuilt`);
}

if (isEntry("demo-reset")) {
  const db = new PrismaClient();
  resetDemo(db)
    .catch((err) => {
      console.error(err);
      process.exit(1);
    })
    .finally(async () => {
      await db.$disconnect();
      await disconnectDemo();
    });
}
