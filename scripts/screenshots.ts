/**
 * Screenshots of the main screens for the documentation and the presentation (docs/img/*.png).
 * Photographs the cabinet screens on the demo lessons, then prepares a live lesson through the API — a ДДС
 * place with a fast card flow and a 112 place with an answered call — and photographs the places, the board and
 * the administrator's screens, every frame at 1600×900.
 *
 *   pnpm exec tsx scripts/screenshots.ts --base http://localhost:3100
 *
 * The script reads the server's database (DATABASE_URL) for the demo group, students and scenario: shoot on a
 * fresh demo database, as on the stand — prisma migrate deploy, prisma/seed.ts, prisma/seed-demo.ts.
 * Uses the installed Google Chrome (or CHROME_PATH). The lesson is deleted at the end.
 */
import { PrismaClient } from "@prisma/client";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";

const args = process.argv.slice(2);
const BASE = args.includes("--base") ? args[args.indexOf("--base") + 1] : "http://localhost:3100";
const OUT = "docs/img";
const db = new PrismaClient();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function signedIn(browser: Browser, login: string, password: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "ru-RU", timezoneId: "Europe/Moscow" });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`);
  const res = await page.request.post(`${BASE}/api/auth/login`, { data: { login, password } });
  if (!res.ok()) throw new Error(`login ${login}: ${res.status()}`);
  return { ctx, page };
}

async function shot(page: Page, name: string, path: string, settle = 1500) {
  await page.goto(`${BASE}${path}`);
  await wait(settle);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`✓ ${name}.png  ${path}`);
}

/** Scrolls so that the section with this heading, with its card, sits at the top of the frame. */
async function shotSection(page: Page, name: string, path: string, heading: string, settle = 1500) {
  await page.goto(`${BASE}${path}`);
  await wait(settle);
  const box = await page.getByText(heading, { exact: true }).first().boundingBox();
  if (box) await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, box.y - 36));
  await wait(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`✓ ${name}.png  ${path} → ${heading}`);
}

async function main() {
  // A Russian browser: date fields read «дд.мм.гггг», not «mm/dd/yyyy».
  const browser = await chromium.launch({
    ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: "chrome" }),
    env: { ...process.env, LANG: "ru_RU.UTF-8", LANGUAGE: "ru" },
  });
  const group = await db.group.findFirstOrThrow({ where: { name: "Учебная группа № 1" } });
  const [s1, s2] = await Promise.all(["student1", "student2"].map((login) => db.user.findUniqueOrThrow({ where: { login } })));
  const scenario = await db.scenario.findFirstOrThrow({ where: { ticketRef: "Б4-1" } });
  const voron = await db.service.findFirstOrThrow({ where: { shortName: "Поселение Вороновское" } });
  // Three different cards for the ДДС place, the first one in its own settlement (ticket 30-3, as on the customer's screenshots).
  const ddsTasks = await Promise.all(["Б30-3", "Б17-1", "Б31-3"].map((ticketRef) => db.scenario.findFirstOrThrow({ where: { ticketRef } })));

  // Cabinet screens first, on the demo lessons only: no running lesson in the lists, the forecasts and the weights.
  const teacher = await signedIn(browser, "teacher", "Teacher2026");
  await shot(teacher.page, "08-lesson-report", "/teacher/lessons/demo-lesson-1/report");
  const attempt = await db.attempt.findFirst({ where: { lessonId: "demo-lesson-2", reviewStatus: "PENDING" }, orderBy: { createdAt: "asc" } });
  if (attempt) await shot(teacher.page, "09-attempt-review", `/teacher/attempts/${attempt.id}`);
  await shot(teacher.page, "10-weights", "/teacher/weights");
  await shot(teacher.page, "11-scenarios", "/teacher/scenarios");
  await shot(teacher.page, "12-scenario-from-text", "/teacher/scenarios/new");
  await shotSection(teacher.page, "16-teacher-forecast", "/teacher/reports", "Прогноз на следующее занятие");
  await shotSection(teacher.page, "17-forecast-vs-fact", "/teacher/lessons/demo-lesson-1/report", "Прогноз ↔ факт");
  await shotSection(teacher.page, "18-forecast-history", "/teacher/reports", "Прогноз ↔ факт по занятиям");
  await shot(teacher.page, "20-teacher-groups", "/teacher/groups");
  const student = await signedIn(browser, "student3", "Student2026");
  await shot(student.page, "15-student-results", "/student/results");

  const created = await teacher.page.request.post(`${BASE}/api/teacher/lessons`, {
    data: {
      title: "Пожары и газ: смена в реальном темпе",
      groupId: group.id,
      settings: { cardSource: "mixed", tempoSec: 10, maxQueue: 3, ackSec: 30, workSec: 180, typingSec: 65, hints: false, brigadeReports: true },
      seats: [
        { studentId: s1.id, role: "OP112", scenarioIds: [scenario.id] },
        { studentId: s2.id, role: "DDS", serviceId: voron.id, scenarioIds: ddsTasks.map((t) => t.id) },
      ],
    },
  });
  const lessonId = ((await created.json()) as { id: string }).id;
  try {
    await teacher.page.request.post(`${BASE}/api/teacher/lessons/${lessonId}/start`);
    const anon = await browser.newContext({ viewport: { width: 1600, height: 900 }, locale: "ru-RU", timezoneId: "Europe/Moscow" });
    await shot(await anon.newPage(), "00-login", "/login", 800); // signed out: a signed-in page would redirect

    // ДДС: let the feed fill up and open the oldest card within 30 s, so the feed shows both norms: the stopwatch
    // to open a card (30 s) and the hourglass to its first record (3 min). Then the card and its status line.
    const dds = await signedIn(browser, "student2", "Student2026");
    await dds.page.goto(`${BASE}/dds`);
    await wait(22_000);
    const oldest = (await dds.page.locator("text=/^368\\d{5}$/").last().textContent())?.trim();
    if (oldest) {
      await dds.page.goto(`${BASE}/dds/incident/${oldest}`);
      await wait(1500);
      await dds.page.goto(`${BASE}/dds`);
      await wait(3000);
    }
    await dds.page.screenshot({ path: `${OUT}/01-dds-feed.png` });
    console.log("✓ 01-dds-feed.png");
    if (oldest) {
      await dds.page.goto(`${BASE}/dds/incident/${oldest}`);
      await wait(2000);
      await dds.page.screenshot({ path: `${OUT}/02-dds-card.png` });
      console.log("✓ 02-dds-card.png");
      // The first record — a status with a text — typed but not saved.
      await dds.page.getByLabel("Поставить статус своей службы").click();
      await dds.page.getByLabel("Статус", { exact: true }).selectOption({ label: "Принята" });
      await dds.page.getByLabel("Комментарий", { exact: true }).fill("Принято в работу, направляем наряд");
      await wait(800);
      await dds.page.screenshot({ path: `${OUT}/03-dds-status.png` });
      console.log("✓ 03-dds-status.png");
    }

    // 112: wait for the ring, take the call and ask the caller through the screen's own API.
    const op = await signedIn(browser, "student1", "Student2026");
    await op.page.goto(`${BASE}/op112`);
    // The call rings a few seconds after the place is free.
    await op.page.getByRole("alertdialog", { name: "Входящий звонок" }).waitFor({ timeout: 20_000 }).catch(() => undefined);
    await wait(800);
    await op.page.screenshot({ path: `${OUT}/04-op112-incoming.png` });
    console.log("✓ 04-op112-incoming.png");
    const ring = (await (await op.page.request.post(`${BASE}/api/op112/ring`)).json()) as { call?: { id: string } };
    if (ring.call) {
      // The caller picks up with «Алло…»; two questions keep the whole talk in the frame.
      await op.page.request.post(`${BASE}/api/op112/calls/${ring.call.id}/answer`);
      for (const text of ["Служба 112, что у вас случилось?", "Назовите точный адрес. Сколько этажей в доме, газ есть?"]) {
        await op.page.request.post(`${BASE}/api/op112/calls/${ring.call.id}/messages`, { data: { text } });
      }
      await op.page.goto(`${BASE}/op112`);
      // In «Голос» the caller's last line is read out: the frame shows the button as «Собеседник говорит».
      await op.page.getByText("Собеседник говорит", { exact: true }).waitFor({ timeout: 15_000 }).catch(() => undefined);
      await wait(500);
      await op.page.screenshot({ path: `${OUT}/05-op112-card.png` });
      console.log("✓ 05-op112-card.png");
    }

    // The live board of this lesson and the administrator's screens while it runs.
    await shot(teacher.page, "06-teacher-board", `/teacher/lessons/${lessonId}`, 3000);
    await shot(teacher.page, "07-teacher-projector", `/teacher/lessons/${lessonId}?projector=1`, 3000);
    const admin = await signedIn(browser, "admin", "Admin2026");
    await shot(admin.page, "13-admin-health", "/admin", 2000);
    await shot(admin.page, "14-admin-audit", "/admin/audit");
    await shot(admin.page, "19-admin-stats", "/admin/stats", 2000);
  } finally {
    await db.lesson.delete({ where: { id: lessonId } }).catch(() => undefined);
    await browser.close();
    await db.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
